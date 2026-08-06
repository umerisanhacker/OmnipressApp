const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configure Sharp to use all available CPU cores for maximum processing speed
sharp.concurrency(0);

// Configure automatic bundled FFmpeg binaries
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files from the root directory where index.html resides
app.use(express.static(__dirname));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit
});

console.log(`\n[SYSTEM BOOT] OmniPress Universal Engine Online on port ${PORT}`);

app.post('/api/compress/universal', upload.single('file'), async (req, res) => {
    console.log(`\n[NETWORK] Incoming Universal file request...`);
    
    if (!req.file) {
        return res.status(400).json({ error: 'No file detected by the server.' });
    }

    const mimeType = req.file.mimetype;
    const requestedFormat = req.body.outputFormat || 'auto';
    const targetSizeKB = parseInt(req.body.targetSize) || 1500;
    const originalName = req.file.originalname;
    const ext = originalName.split('.').pop().toLowerCase();
    const targetSizeBytes = targetSizeKB * 1024;
    
    console.log(`[ROUTER] File: ${originalName} | Type: ${mimeType} | Target: ${targetSizeKB}KB | Format: ${requestedFormat}`);

    try {
        // --- ROUTE 1: IMAGES (Strict Iterative Dimension & Quality Downscaling) ---
        if (mimeType.startsWith('image/')) {
            let targetFormat = requestedFormat === 'auto' ? ext : requestedFormat;
            let outputExtension = targetFormat;
            let quality = 90;
            let scale = 1.0;
            let compressedBuffer;

            const metadata = await sharp(req.file.buffer).metadata();
            const originalWidth = metadata.width || 800;

            while (true) {
                let imagePipeline = sharp(req.file.buffer);

                if (scale < 1.0) {
                    const currentWidth = Math.max(40, Math.round(originalWidth * scale));
                    imagePipeline = imagePipeline.resize(currentWidth);
                }

                if (targetFormat === 'jpg' || targetFormat === 'jpeg') {
                    imagePipeline = imagePipeline.jpeg({ quality: quality, force: true });
                    outputExtension = targetFormat;
                } else if (targetFormat === 'png') {
                    imagePipeline = imagePipeline.png({ quality: Math.max(1, Math.round(quality / 10)), force: true });
                    outputExtension = 'png';
                } else if (targetFormat === 'webp') {
                    imagePipeline = imagePipeline.webp({ quality: quality, force: true });
                    outputExtension = 'webp';
                } else if (targetFormat === 'avif') {
                    imagePipeline = imagePipeline.avif({ quality: quality, force: true });
                    outputExtension = 'avif';
                } else {
                    imagePipeline = imagePipeline.jpeg({ quality: quality, force: true });
                    outputExtension = ext || 'jpg';
                }

                compressedBuffer = await imagePipeline.toBuffer();

                if (compressedBuffer.length <= targetSizeBytes || (quality <= 15 && scale <= 0.15)) {
                    break;
                }

                if (quality > 25) {
                    quality -= 20;
                } else {
                    scale -= 0.2;
                    quality = 70;
                }
            }

            console.log(`[SUCCESS] Image optimized. Output size: ${Math.round(compressedBuffer.length/1024)}KB`);
            const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            
            res.set('Content-Disposition', `attachment; filename="OmniPress-${baseName}.${outputExtension}"`);
            res.set('Content-Type', `image/${outputExtension === 'jpg' ? 'jpeg' : outputExtension}`);
            return res.send(compressedBuffer);
        }
        
        // --- ROUTE 2: VIDEOS & AUDIO (Strict Byte Limit & Resolution Scaling) ---
        else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || ext === 'mp4' || ext === 'mov' || ext === 'mp3') {
            console.log(`[ROUTER] Routing to FFmpeg Media Engine with Strict Byte Limits...`);
            
            const uniqueId = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
            const tempInputPath = path.join(os.tmpdir(), `temp_in_${uniqueId}_${originalName}`);
            const tempOutputPath = path.join(os.tmpdir(), `temp_out_${uniqueId}.${requestedFormat === 'mp3' ? 'mp3' : 'mp4'}`);

            fs.writeFileSync(tempInputPath, req.file.buffer);

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(tempInputPath, (err, metadata) => {
                        let videoBitrateOpt = '200k';
                        let audioBitrateOpt = '24k';
                        let scaleFilter = 'scale=320:-2';
                        
                        if (!err && metadata && metadata.format && metadata.format.duration) {
                            const duration = metadata.format.duration;
                            const targetBits = targetSizeKB * 1024 * 8;
                            const totalBps = targetBits / duration;
                            
                            const audioBps = Math.min(32 * 1024, Math.max(8 * 1024, totalBps * 0.25));
                            const videoBps = Math.max(12 * 1024, totalBps - audioBps);
                            
                            videoBitrateOpt = `${Math.max(12, Math.floor(videoBps / 1000))}k`;
                            audioBitrateOpt = `${Math.max(8, Math.floor(audioBps / 1000))}k`;
                            
                            if (targetSizeKB <= 150) {
                                scaleFilter = 'scale=192:-2';
                            } else if (targetSizeKB <= 500) {
                                scaleFilter = 'scale=256:-2';
                            } else if (targetSizeKB <= 1500) {
                                scaleFilter = 'scale=426:-2';
                            } else {
                                scaleFilter = 'scale=640:-2';
                            }

                            console.log(`[FFMPEG] Duration: ${duration}s | Bitrate: ${videoBitrateOpt} | Scale: ${scaleFilter}`);
                        }

                        let command = ffmpeg(tempInputPath);

                        if (requestedFormat === 'mp3' || mimeType.startsWith('audio/')) {
                            command.audioCodec('libmp3lame').audioBitrate(audioBitrateOpt);
                        } else {
                            command.videoCodec('libx264')
                                   .audioCodec('aac')
                                   .audioBitrate(audioBitrateOpt);

                            const outputOpts = [
                                `-b:v ${videoBitrateOpt}`,
                                `-maxrate ${videoBitrateOpt}`,
                                `-bufsize ${parseInt(videoBitrateOpt) * 2}k`,
                                `-fs ${targetSizeBytes}`,
                                '-preset ultrafast',
                                '-tune zerolatency',
                                '-threads 0',      // Uses all available CPU threads for faster encoding
                                '-row-mt 1',       // Enables row-based multithreading
                                `-vf ${scaleFilter}`
                            ];

                            command.outputOptions(outputOpts);
                        }

                        command
                            .save(tempOutputPath)
                            .on('end', () => resolve())
                            .on('error', (err) => reject(err));
                    });
                });

                const processedBuffer = fs.readFileSync(tempOutputPath);
                
                console.log(`[SUCCESS] Media encoded. Final size: ${Math.round(processedBuffer.length/1024)}KB (Target was ${targetSizeKB}KB)`);
                const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
                const finalExt = requestedFormat === 'mp3' ? 'mp3' : 'mp4';

                res.set('Content-Disposition', `attachment; filename="OmniPress-${baseName}.${finalExt}"`);
                res.set('Content-Type', finalExt === 'mp3' ? 'audio/mpeg' : 'video/mp4');
                return res.send(processedBuffer);

            } finally {
                if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
                if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            }
        }
        
        // --- ROUTE 3: DOCUMENTS & ARCHIVES (ZIP Compression) ---
        else {
            console.log(`[ROUTER] Routing to Document/Archive Engine...`);
            const uniqueId = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
            const tempInputPath = path.join(os.tmpdir(), `temp_doc_${uniqueId}_${originalName}`);
            const archivePath = path.join(os.tmpdir(), `archive_${uniqueId}.zip`);

            fs.writeFileSync(tempInputPath, req.file.buffer);

            try {
                const output = fs.createWriteStream(archivePath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                await new Promise((resolve, reject) => {
                    output.on('close', () => resolve());
                    archive.on('error', (err) => reject(err));
                    archive.pipe(output);
                    archive.file(tempInputPath, { name: originalName });
                    archive.finalize();
                });

                const zippedBuffer = fs.readFileSync(archivePath);

                console.log(`[SUCCESS] Document compressed into archive. Size: ${Math.round(zippedBuffer.length/1024)}KB`);
                const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;

                res.set('Content-Disposition', `attachment; filename="OmniPress-${baseName}-compressed.zip"`);
                res.set('Content-Type', 'application/zip');
                return res.send(zippedBuffer);

            } finally {
                if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
                if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
            }
        }

    } catch (error) {
        console.error(`[ENGINE FAILURE] ${error.message}`);
        res.status(500).json({ error: error.message || 'Critical server error during processing.' });
    }
});

app.listen(PORT, () => {
    console.log(`[SYSTEM] OmniPress Server active on port ${PORT}`);
});
