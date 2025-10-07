import sharp from 'sharp';

export interface ServerCompressionOptions {
  maxSizeInMB?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ServerCompressionResult {
  compressedBuffer: Buffer;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  wasCompressed: boolean;
}

/**
 * Converts bytes to MB
 */
export function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

/**
 * Converts MB to bytes
 */
export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

/**
 * Gets file size in human readable format
 */
export function getFileSizeString(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Compresses an image file on the server using Sharp
 */
export async function compressImageServer(
  buffer: Buffer,
  options: ServerCompressionOptions = {}
): Promise<ServerCompressionResult> {
  const {
    maxSizeInMB = 9, // Default to 9MB for Cloudinary
    quality = 95,    // Default to 95% quality
    maxWidth = 6000, // Default to 6K max width
    maxHeight = 6000 // Default to 6K max height
  } = options;

  const maxSizeInBytes = mbToBytes(maxSizeInMB);
  const originalSize = buffer.length;
  
  // If file is already under the limit, return as-is
  if (originalSize <= maxSizeInBytes) {
    return {
      compressedBuffer: buffer,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      wasCompressed: false
    };
  }

  try {
    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    console.log('Image metadata:', {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: originalSize
    });

    let { width, height } = metadata;
    
    // Resize if image is too large
    if (width && height && (width > maxWidth || height > maxHeight)) {
      const aspectRatio = width / height;
      
      if (width > height) {
        width = Math.min(maxWidth, width);
        height = Math.round(width / aspectRatio);
      } else {
        height = Math.min(maxHeight, height);
        width = Math.round(height * aspectRatio);
      }
      
      console.log(`Resizing image to: ${width}x${height}`);
    }

    // Start with high quality and reduce if needed
    let currentQuality = quality;
    let compressedBuffer: Buffer;
    
    // Try compression with current quality
    const tryCompression = async (testQuality: number): Promise<Buffer> => {
      let sharpInstance = sharp(buffer);
      
      // Resize if needed
      if (width && height && (width !== metadata.width || height !== metadata.height)) {
        sharpInstance = sharpInstance.resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }
      
      // Apply compression based on format
      if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
        sharpInstance = sharpInstance.jpeg({ quality: testQuality, progressive: true });
      } else if (metadata.format === 'png') {
        sharpInstance = sharpInstance.png({ quality: testQuality, progressive: true });
      } else if (metadata.format === 'webp') {
        sharpInstance = sharpInstance.webp({ quality: testQuality });
      } else {
        // Default to JPEG for other formats
        sharpInstance = sharpInstance.jpeg({ quality: testQuality, progressive: true });
      }
      
      return await sharpInstance.toBuffer();
    };

    // Try compression with initial quality
    compressedBuffer = await tryCompression(currentQuality);
    
    // If still too large, reduce quality
    if (compressedBuffer.length > maxSizeInBytes) {
      console.log(`Initial compression too large: ${getFileSizeString(compressedBuffer.length)}, reducing quality...`);
      
      // Calculate target quality based on size ratio
      const sizeRatio = maxSizeInBytes / compressedBuffer.length;
      currentQuality = Math.max(70, Math.min(95, Math.round(currentQuality * sizeRatio)));
      
      console.log(`Trying with quality: ${currentQuality}%`);
      compressedBuffer = await tryCompression(currentQuality);
      
      // If still too large, try one more time with lower quality
      if (compressedBuffer.length > maxSizeInBytes) {
        currentQuality = Math.max(60, Math.round(currentQuality * 0.8));
        console.log(`Final attempt with quality: ${currentQuality}%`);
        compressedBuffer = await tryCompression(currentQuality);
      }
    }

    console.log(`Server compression successful: ${getFileSizeString(originalSize)} → ${getFileSizeString(compressedBuffer.length)} (quality: ${currentQuality}%)`);
    
    return {
      compressedBuffer,
      originalSize,
      compressedSize: compressedBuffer.length,
      compressionRatio: compressedBuffer.length / originalSize,
      wasCompressed: true
    };

  } catch (error) {
    console.error('Server image compression failed:', error);
    // Return original buffer if compression fails
    return {
      compressedBuffer: buffer,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1,
      wasCompressed: false
    };
  }
}

