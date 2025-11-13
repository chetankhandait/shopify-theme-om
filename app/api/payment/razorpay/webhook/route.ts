import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// In-memory store for pending orders (in production, use Redis or database)
const pendingOrders = new Map<string, any>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-razorpay-signature');

    if (!signature || !RAZORPAY_WEBHOOK_SECRET) {
      console.error('Missing webhook signature or secret');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(body);
    console.log('Razorpay webhook event:', event.event);

    // Handle different payment events
    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;
      
      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity);
        break;
      
      case 'order.paid':
        await handleOrderPaid(event.payload.order.entity);
        break;
      
      default:
        console.log('Unhandled webhook event:', event.event);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// Handle successful payment capture
async function handlePaymentCaptured(payment: any) {
  try {
    console.log('Payment captured:', payment.id);
    
    // Get payment details from Razorpay
    const paymentDetails = await fetchPaymentDetails(payment.id);
    if (!paymentDetails) {
      console.error('Failed to fetch payment details for:', payment.id);
      return;
    }

    // Check if order already exists
    const existingOrder = await checkExistingOrder(payment.id);
    if (existingOrder) {
      console.log('Order already exists for payment:', payment.id);
      return;
    }

    // Get pending order data
    const pendingOrderData = pendingOrders.get(payment.order_id);
    if (!pendingOrderData) {
      console.error('No pending order data found for payment:', payment.id);
      // Try to create order with minimal data
      await createOrderFromPayment(paymentDetails);
      return;
    }

    // Create order in Shopify
    await createShopifyOrderFromWebhook(pendingOrderData, paymentDetails);
    
    // Remove from pending orders
    pendingOrders.delete(payment.order_id);
    
  } catch (error) {
    console.error('Error handling payment capture:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(payment: any) {
  try {
    console.log('Payment failed:', payment.id);
    
    // Remove from pending orders
    pendingOrders.delete(payment.order_id);
    
    // You can add logic here to notify the user or update your system
    // For example, send an email notification about failed payment
    
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

// Handle order paid event
async function handleOrderPaid(order: any) {
  try {
    console.log('Order paid:', order.id);
    
    // This is a backup handler in case payment.captured doesn't fire
    const paymentDetails = await fetchPaymentDetails(order.id);
    if (paymentDetails) {
      await handlePaymentCaptured(paymentDetails);
    }
    
  } catch (error) {
    console.error('Error handling order paid:', error);
  }
}

// Fetch payment details from Razorpay
async function fetchPaymentDetails(paymentId: string) {
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch payment details:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching payment details:', error);
    return null;
  }
}

// Check if order already exists in Shopify
async function checkExistingOrder(paymentId: string): Promise<boolean> {
  try {
    const shopifyDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
    const adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shopifyDomain || !adminAccessToken) {
      return false;
    }

    // Search for orders with this payment ID in notes or transactions
    const response = await fetch(
      `https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&limit=250`,
      {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': adminAccessToken,
        },
      }
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const orders = data.orders || [];

    // Check if any order contains this payment ID
    return orders.some((order: any) => 
      order.note?.includes(paymentId) || 
      order.transactions?.some((tx: any) => tx.gateway === 'razorpay' && tx.payment_details?.credit_card_number === paymentId)
    );
  } catch (error) {
    console.error('Error checking existing order:', error);
    return false;
  }
}

// Create order with minimal data when pending order data is not available
async function createOrderFromPayment(paymentDetails: any) {
  try {
    console.log('Creating order from payment details only:', paymentDetails.id);
    
    // This is a fallback - you might want to store minimal order data
    // or redirect user to complete the order
    const orderData = {
      email: paymentDetails.email || 'unknown@example.com',
      shipping_address: {
        first_name: 'Unknown',
        last_name: 'Customer',
        address1: 'Address not provided',
        city: 'Unknown',
        province: 'Unknown',
        zip: '000000',
        country: 'India',
        phone: paymentDetails.contact || '0000000000',
      },
      line_items: [{
        variant_id: '1', // You might need to store this differently
        quantity: 1,
        price: (paymentDetails.amount / 100).toFixed(2),
      }],
      total_price: (paymentDetails.amount / 100).toFixed(2),
      payment_method: 'razorpay',
      payment_details: {
        payment_id: paymentDetails.id,
        order_id: paymentDetails.order_id,
        method: paymentDetails.method,
      },
      note: `Webhook-created order for payment: ${paymentDetails.id}`,
    };

    await createShopifyOrderFromWebhook(orderData, paymentDetails);
  } catch (error) {
    console.error('Error creating order from payment:', error);
  }
}

// Create Shopify order from webhook data
async function createShopifyOrderFromWebhook(orderData: any, paymentDetails: any) {
  try {
    const shopifyDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
    const adminAccessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!shopifyDomain || !adminAccessToken) {
      throw new Error('Shopify credentials missing');
    }

    const shopifyOrderData = {
      order: {
        email: orderData.email,
        financial_status: 'paid',
        fulfillment_status: 'unfulfilled',
        send_receipt: true,
        send_fulfillment_receipt: true,
        line_items: orderData.line_items,
        shipping_address: orderData.shipping_address,
        billing_address: orderData.billing_address || orderData.shipping_address,
        shipping_lines: orderData.shipping_lines || [{
          title: 'Standard Shipping',
          price: '0.00',
          code: 'standard',
        }],
        tags: 'website-order,webhook-created',
        note: `${orderData.note || ''}\nPayment ID: ${paymentDetails.id}\nWebhook Created: ${new Date().toISOString()}`,
        transactions: [{
          kind: 'sale',
          status: 'success',
          amount: orderData.total_price,
          gateway: 'razorpay',
          payment_details: {
            credit_card_number: paymentDetails.id,
            credit_card_company: 'Razorpay',
          },
        }],
      },
    };

    const response = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminAccessToken,
      },
      body: JSON.stringify(shopifyOrderData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Shopify order creation error:', errorData);
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Order created successfully via webhook:', result.order.id);
    
    return result.order;
  } catch (error) {
    console.error('Error creating Shopify order from webhook:', error);
    throw error;
  }
}

// Store pending order data (called from checkout)
export function storePendingOrder(razorpayOrderId: string, orderData: any) {
  pendingOrders.set(razorpayOrderId, orderData);
  
  // Clean up after 30 minutes
  setTimeout(() => {
    pendingOrders.delete(razorpayOrderId);
  }, 30 * 60 * 1000);
}



