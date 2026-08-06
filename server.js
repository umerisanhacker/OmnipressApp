const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const os = require('os');

sharp.concurrency(0);

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 }
});

const sanitizeFilename = (name) => {
    if (!name) return 'file';
    return path.basename(name).replace(/[^a-zA-Z0-9.-]/g, '_');
};

console.log(`\n[SYSTEM BOOT] OmniPress Universal Engine Online on port ${PORT}`);

app.post('/api/compress/universal', upload.single('file'), async (req, res) => {
    console.log(`\n[NETWORK] Incoming Universal file request...`);
    
    if (!req.file) {
        return res.status(400).json({ error: 'No file detected by the server.' });
    }

    const mimeType = req.file.mimetype;
    const targetSizeKB = parseInt(req.body.targetSize) || 1500;
    const targetBytes = targetSizeKB * 1024;
    const originalName = sanitizeFilename(req.file.originalname);
    const ext = originalName.split('.').pop().toLowerCase();
    const uniqueId = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    
    console.log(`[ROUTER] File: ${originalName} | Type: ${mimeType} | Target: ${targetSizeKB}KB`);

    try {
        // --- HIGH-CLARITY IMAGE ROUTING (Sharp Engine) ---
        if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(ext)) {
            console.log(`[ROUTER] Routing to Clarity-First Sharp Image Engine...`);
            let outputBuffer = null;
            let currentQuality = 92;

            // Phase 1: Try reducing quality gradually while maintaining 100% original dimensions & aspect ratio
            while (currentQuality >= 35) {
                let transformer = sharp(req.file.buffer);
                if (ext === 'png' || mimeType === 'image/png') {
                    outputBuffer = await transformer.png({ compressionLevel: 9 }).toBuffer();
                    break; // PNGs don't use lossy quality steps
                } else if (ext === 'webp' || mimeType === 'image/webp') {
                    outputBuffer = await transformer.webp({ quality: currentQuality }).toBuffer();
                } else if (ext === 'avif' || mimeType === 'image/avif') {
                    outputBuffer = await transformer.avif({ quality: currentQuality }).toBuffer();
                } else {
                    outputBuffer = await transformer.jpeg({ quality: currentQuality, mozjpeg: true }).toBuffer();
                }

                if (outputBuffer.length <= targetBytes) {
                    break;
                }
                currentQuality -= 4; // Fine-grained drops to preserve maximum clarity
            }

            // Phase 2: If quality alone wasn't enough, gently scale down dimensions while strictly preserving aspect ratio
            if (outputBuffer.length > targetBytes && ext !== 'png') {
                let scale = 0.95;
                for (let i = 0; i < 4; i++) {
                    let transformer = sharp(req.file.buffer);
                    const metadata = await transformer.metadata();
                    let targetWidth = Math.round(metadata.width * scale);
                    let targetHeight = Math.round(metadata.height * scale);

                    transformer = transformer.resize(targetWidth, targetHeight, { 
                        fit: 'inside', 
                        withoutEnlargement: true 
                    });

                    if (ext === 'webp' || mimeType === 'image/webp') {
                        outputBuffer = await transformer.webp({ quality: 60 }).toBuffer();
                    } else if (ext === 'avif' || mimeType === 'image/avif') {
                        outputBuffer = await transformer.avif({ quality: 60 }).toBuffer();
                    } else {
                        outputBuffer = await transformer.jpeg({ quality: 60, mozjpeg: true }).toBuffer();
                    }

                    if (outputBuffer.length <= targetBytes) break;
                    scale -= 0.1;
                }
            }

            console.log(`[SUCCESS] Image optimized with max clarity. Final size: ${Math.round(outputBuffer.length / 1024)}KB`);
            const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            
            res.set('Content-Disposition', `attachment; filename="OmniPress-${baseName}.${ext}"`);
            res.set('Content-Type', mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`);
            return res.send(outputBuffer);
        }

        // --- VIDEO & AUDIO ROUTING ---
        else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || ['mp4', 'mov', 'mp3', 'mkv', 'avi'].includes(ext)) {
            console.log(`[ROUTER] Routing to FFmpeg Media Engine...`);
            
            const tempInputPath = path.join(os.tmpdir(), `temp_in_${uniqueId}_${originalName}`);
            const isMp3 = mimeType.startsWith('audio/') || ext === 'mp3';
            const tempOutputPath = path.join(os.tmpdir(), `temp_out_${uniqueId}.${isMp3 ? 'mp3' : 'mp4'}`);

            fs.writeFileSync(tempInputPath, req.file.buffer);

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(tempInputPath, (err, metadata) => {
                        let videoBitrateOpt = '400k';
                        let audioBitrateOpt = '64k';
                        let scaleFilter = 'scale=640:-2';
                        
                        if (!err && metadata && metadata.format && metadata.format.duration) {
                            const duration = metadata.format.duration;
                            const targetBits = targetSizeKB * 1024 * 8;
                            const totalBps = targetBits / duration;
                            
                            const audioBps = Math.min(64 * 1024, Math.max(24 * 1024, totalBps * 0.25));
                            const videoBps = Math.max(64 * 1024, totalBps - audioBps);
                            
                            videoBitrateOpt = `${Math.max(64, Math.floor(videoBps / 1000))}k`;
                            audioBitrateOpt = `${Math.max(24, Math.floor(audioBps / 1000))}k`;
                            
                            if (targetSizeKB <= 1000) {
                                scaleFilter = 'scale=480:-2';
                            } else if (targetSizeKB <= 3000) {
                                scaleFilter = 'scale=854:-2';
                            } else {
                                scaleFilter = 'scale=1280:-2';
                            }
                        }

                        let command = ffmpeg(tempInputPath);

                        if (isMp3) {
                            command.audioCodec('libmp3lame').audioBitrate(audioBitrateOpt);
                        } else {
                            command.videoCodec('libx264')
                                   .audioCodec('aac')
                                   .audioBitrate(audioBitrateOpt);

                            const outputOpts = [
                                `-b:v ${videoBitrateOpt}`,
                                `-maxrate ${videoBitrateOpt}`,
                                `-bufsize ${parseInt(videoBitrateOpt) * 2}k`,
                                '-preset medium', // Better visual retention preset
                                '-threads 0',
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
                console.log(`[SUCCESS] Media encoded. Final size: ${Math.round(processedBuffer.length/1024)}KB`);
                
                const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
                const finalExt = isMp3 ? 'mp3' : 'mp4';

                res.set('Content-Disposition', `attachment; filename="OmniPress-${baseName}.${finalExt}"`);
                res.set('Content-Type', finalExt === 'mp3' ? 'audio/mpeg' : 'video/mp4');
                return res.send(processedBuffer);

            } finally {
                if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
                if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            }
        }
        
        // --- DOCUMENTS & PDFS ROUTING ---
        else {
            console.log(`[ROUTER] Routing to Document & Archive Engine...`);
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
                console.log(`[SUCCESS] Document compressed into ZIP archive. Size: ${Math.round(zippedBuffer.length/1024)}KB`);
                
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
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Critical server error during processing.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`[SYSTEM] OmniPress Server active on port ${PORT}`);
});
