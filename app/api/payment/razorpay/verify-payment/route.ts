import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export async function POST(request: NextRequest) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderData } = await request.json();

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: 'Missing payment verification parameters' }, { status: 400 });
    }

    if (!RAZORPAY_KEY_SECRET) {
      console.error('Razorpay key secret missing');
      return NextResponse.json({ error: 'Payment verification configuration error' }, { status: 500 });
    }

    // Verify signature
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest('hex');

    const isSignatureValid = expectedSignature === razorpay_signature;

    if (!isSignatureValid) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    // Get payment details from Razorpay
    const response = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Razorpay payment fetch error:', errorData);
      return NextResponse.json(
        { error: 'Failed to fetch payment details', details: errorData },
        { status: response.status }
      );
    }

    const paymentData = await response.json();

    // Store pending order data for webhook processing
    if (orderData) {
      const { storePendingOrder } = await import('../webhook/route');
      storePendingOrder(razorpay_order_id, orderData);
    }

    // Try to create order immediately (client-side fallback)
    let orderCreated = false;
    if (orderData) {
      try {
        await createOrderImmediately(orderData, paymentData);
        orderCreated = true;
      } catch (error) {
        console.error('Immediate order creation failed, will rely on webhook:', error);
        // Don't fail the payment verification - webhook will handle order creation
      }
    }

    // Return success response with payment details
    return NextResponse.json({
      success: true,
      payment: {
        id: paymentData.id,
        order_id: paymentData.order_id,
        amount: paymentData.amount / 100, // Convert from paisa to rupees
        currency: paymentData.currency,
        status: paymentData.status,
        method: paymentData.method,
        email: paymentData.email,
        contact: paymentData.contact,
        created_at: paymentData.created_at,
      },
      order_created: orderCreated,
      message: orderCreated 
        ? 'Payment verified and order created successfully' 
        : 'Payment verified. Order will be created via webhook.',
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    return NextResponse.json(
      { error: 'Failed to verify payment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Create order immediately as a fallback
async function createOrderImmediately(orderData: any, paymentData: any) {
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
        tags: 'website-order,immediate-creation',
        note: `${orderData.note || ''}\nPayment ID: ${paymentData.id}\nCreated: ${new Date().toISOString()}`,
        transactions: [{
          kind: 'sale',
          status: 'success',
          amount: orderData.total_price,
          gateway: 'razorpay',
          payment_details: {
            credit_card_number: paymentData.id,
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
    console.log('Order created immediately:', result.order.id);
    return result.order;
  } catch (error) {
    console.error('Error creating order immediately:', error);
    throw error;
  }
}
