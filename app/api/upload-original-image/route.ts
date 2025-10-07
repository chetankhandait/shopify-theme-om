import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { compressImageServer } from '@/lib/server-image-compression';

// Configure Cloudinary once
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    console.log('Original image upload request received');
    
    // Check for required environment variables
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.error('Missing Cloudinary environment variables');
      return NextResponse.json(
        { error: 'Cloudinary configuration is missing. Please check your environment variables.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const filename = formData.get('filename') as string;

    if (!file) {
      console.error('No file provided in request');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log('Original file details:', {
      name: file.name,
      size: file.size,
      type: file.type,
      filename
    });

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      console.error('File too large:', file.size, 'bytes');
      return NextResponse.json(
        { error: 'File too large. Maximum size is 50MB.' },
        { status: 413 }
      );
    }

    // Convert file to buffer first
    console.log('Converting original file to buffer...');
    const bytes = await file.arrayBuffer();
    let buffer = Buffer.from(bytes);
    console.log('Original buffer created, size:', buffer.length);
    
    // Compress original image if it's larger than 2MB
    if (buffer.length > 2 * 1024 * 1024) {
      console.log('Compressing original image for storage...');
      try {
        const compressionResult = await compressImageServer(buffer, {
          maxSizeInMB: 9,  // Under Cloudinary's 10MB limit
          quality: 98,     // Very high quality for original (98%)
          maxWidth: 8000,  // Higher resolution limit for original
          maxHeight: 8000  // Higher resolution limit for original
        });
        
        if (compressionResult.wasCompressed) {
          console.log(`Original image compressed: ${(buffer.length / 1024 / 1024).toFixed(1)}MB → ${(compressionResult.compressedSize / 1024 / 1024).toFixed(1)}MB`);
          buffer = compressionResult.compressedBuffer;
        }
      } catch (error) {
        console.error('Original image compression failed:', error);
        // Continue with original buffer if compression fails
      }
    }

    // Upload to Cloudinary with timeout
    console.log('Starting original image Cloudinary upload...');
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          public_id: `original-${filename}`, // Prefix with 'original-' to distinguish
          folder: 'product-customizations/originals',
          format: 'png',
          quality: 'auto:best', // Use best quality for original images
          fetch_format: 'auto',
        },
        (error, result) => {
          if (error) {
            console.error('Original image Cloudinary upload error:', error);
            reject(new Error(`Cloudinary upload failed: ${error.message}`));
          } else {
            console.log('Original image Cloudinary upload successful');
            resolve(result);
          }
        }
      );
      
      // Set timeout for upload
      const timeout = setTimeout(() => {
        uploadStream.destroy();
        reject(new Error('Upload timeout - file too large or network issue'));
      }, 120000); // 2 minute timeout for larger files
      
      uploadStream.on('end', () => {
        clearTimeout(timeout);
      });
      
      uploadStream.end(buffer);
    });

    const uploadResult = result as any;
    console.log('Original image upload successful:', uploadResult.secure_url);
    
    return NextResponse.json({
      secure_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      original_size: file.size,
      processed_size: buffer.length,
      was_compressed: buffer.length !== file.size
    });

  } catch (error) {
    console.error('Original image upload API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { 
        error: 'Original image upload failed', 
        details: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
