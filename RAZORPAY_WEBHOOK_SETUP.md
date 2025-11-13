# Razorpay Webhook Setup Guide

This guide will help you set up Razorpay webhooks to prevent payment-order conflicts when network issues occur.

## 🚀 What This Solves

**Problem**: If user's network drops after successful Razorpay payment but before order creation, they get charged but no order is created.

**Solution**: Webhook system ensures orders are created server-side even if user's browser disconnects.

## 📋 Setup Steps

### 1. Configure Environment Variables

Add these to your `.env.local` file:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=your-razorpay-key-id
RAZORPAY_KEY_SECRET=your-razorpay-key-secret
RAZORPAY_WEBHOOK_SECRET=your-razorpay-webhook-secret
```

### 2. Set Up Razorpay Webhook

1. **Login to Razorpay Dashboard**
   - Go to [Razorpay Dashboard](https://dashboard.razorpay.com/)
   - Navigate to Settings → Webhooks

2. **Create New Webhook**
   - Click "Add New Webhook"
   - **URL**: `https://yourdomain.com/api/payment/razorpay/webhook`
   - **Events to Subscribe**:
     - `payment.captured`
     - `payment.failed`
     - `order.paid`

3. **Get Webhook Secret**
   - After creating webhook, copy the "Webhook Secret"
   - Add it to your `.env.local` as `RAZORPAY_WEBHOOK_SECRET`

### 3. Test Webhook (Optional)

Use Razorpay's webhook testing tool or ngrok for local testing:

```bash
# Install ngrok
npm install -g ngrok

# Expose your local server
ngrok http 3000

# Use the ngrok URL in Razorpay webhook settings
# Example: https://abc123.ngrok.io/api/payment/razorpay/webhook
```

## 🔧 How It Works

### Payment Flow with Webhooks

1. **User initiates payment** → Razorpay checkout opens
2. **Payment successful** → Razorpay sends webhook to your server
3. **Webhook processes** → Creates order in Shopify (server-side)
4. **User gets confirmation** → Order created regardless of network issues

### Fallback System

- **Primary**: Webhook creates order server-side
- **Fallback**: Client-side order creation if webhook fails
- **Safety**: Duplicate order prevention built-in

## 🛡️ Security Features

- **Signature Verification**: All webhooks verified with HMAC-SHA256
- **Duplicate Prevention**: Checks for existing orders before creating
- **Error Handling**: Comprehensive error logging and recovery

## 📊 Monitoring

### Check Webhook Status

1. **Razorpay Dashboard** → Settings → Webhooks
2. **View delivery logs** for success/failure rates
3. **Check your server logs** for webhook processing

### Common Issues

| Issue | Solution |
|-------|----------|
| Webhook not receiving | Check URL is accessible and returns 200 |
| Signature verification fails | Verify `RAZORPAY_WEBHOOK_SECRET` is correct |
| Orders not created | Check Shopify API credentials and logs |

## 🚨 Important Notes

1. **Webhook URL must be HTTPS** in production
2. **Webhook secret must match** exactly in Razorpay dashboard
3. **Test thoroughly** before going live
4. **Monitor webhook logs** regularly

## 🔄 Testing the System

### Test Payment Flow

1. Make a test payment
2. Check if order appears in Shopify admin
3. Verify webhook logs in Razorpay dashboard
4. Test network disconnection scenario

### Test Webhook Manually

```bash
curl -X POST https://yourdomain.com/api/payment/razorpay/webhook \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: your-test-signature" \
  -d '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test123"}}}}'
```

## 📞 Support

If you encounter issues:

1. Check server logs for error messages
2. Verify all environment variables are set
3. Test webhook URL accessibility
4. Contact Razorpay support for webhook issues

---

**✅ Once configured, your payment system will be resilient to network issues and ensure orders are always created when payments succeed.**



