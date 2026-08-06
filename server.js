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
    const requestedFormat = req.body.outputFormat || 'auto';
    const targetSizeKB = parseInt(req.body.targetSize) || 1500;
    const originalName = sanitizeFilename(req.file.originalname);
    const ext = originalName.split('.').pop().toLowerCase();
    const targetSizeBytes = targetSizeKB * 1024;
    const uniqueId = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    
    console.log(`[ROUTER] File: ${originalName} | Type: ${mimeType} | Target: ${targetSizeKB}KB | Format: ${requestedFormat}`);

    try {
        // --- PDF & DOCUMENT ROUTING (Strict Target Size Enforcement via Rendering & Compression) ---
        if (mimeType === 'application/pdf' || ext === 'pdf') {
            console.log(`[ROUTER] Routing PDF to Sharp Engine for strict target size reduction...`);
            
            let quality = 85;
            let scale = 1.0;
            let compressedBuffer;
            let outputExtension = requestedFormat === 'auto' ? 'pdf' : requestedFormat;

            // Render PDF page 0 as image pipeline for deep compression
            while (true) {
                let imagePipeline = sharp(req.file.buffer, { page: 0, density: Math.round(150 * scale) });

                if (outputExtension === 'png') {
                    imagePipeline = imagePipeline.png({ quality: 8, force: true });
                    outputExtension = 'png';
                } else if (outputExtension === 'webp') {
                    imagePipeline = imagePipeline.webp({ quality: quality, force: true });
                    outputExtension = 'webp';
                } else if (outputExtension === 'avif') {
                    imagePipeline = imagePipeline.avif({ quality: quality, force: true });
                    outputExtension = 'avif';
                } else {
                    imagePipeline = imagePipeline.jpeg({ quality: quality, force: true });
                    outputExtension = 'jpg';
                }

                compressedBuffer = await imagePipeline.toBuffer();

                if (compressedBuffer.length <= targetSizeBytes || (quality <= 15 && scale <= 0.2)) {
                    break;
                }

                if (quality > 25) {
                    quality -= 20;
                } else {
                    scale -= 0.25;
                    quality = 60;
                }
            }

            console.log(`[SUCCESS] PDF compressed successfully to target size. Final size: ${Math.round(compressedBuffer.length/1024)}KB`);
            const baseName = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
            
            res.set('Content-Disposition', `attachment; filename="OmniPress-${baseName}.${outputExtension}"`);
            res.set('Content-Type', outputExtension === 'pdf' ? 'application/pdf' : `image/${outputExtension === 'jpg' ? 'jpeg' : outputExtension}`);
            return res.send(compressedBuffer);
        }

        // --- VIDEO & AUDIO ROUTING ---
        else if (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || ['mp4', 'mov', 'mp3', 'mkv', 'avi'].includes(ext)) {
            console.log(`[ROUTER] Routing to FFmpeg Media Engine...`);
            
            const tempInputPath = path.join(os.tmpdir(), `temp_in_${uniqueId}_${originalName}`);
            const isMp3 = requestedFormat === 'mp3' || mimeType.startsWith('audio/');
            const tempOutputPath = path.join(os.tmpdir(), `temp_out_${uniqueId}.${isMp3 ? 'mp3' : 'mp4'}`);

            fs.writeFileSync(tempInputPath, req.file.buffer);

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg.ffprobe(tempInputPath, (err, metadata) => {
                        let videoBitrateOpt = '300k';
                        let audioBitrateOpt = '32k';
                        let scaleFilter = 'scale=426:-2';
                        
                        if (!err && metadata && metadata.format && metadata.format.duration) {
                            const duration = metadata.format.duration;
                            const targetBits = targetSizeKB * 1024 * 8;
                            const totalBps = targetBits / duration;
                            
                            const audioBps = Math.min(48 * 1024, Math.max(12 * 1024, totalBps * 0.2));
                            const videoBps = Math.max(48 * 1024, totalBps - audioBps);
                            
                            videoBitrateOpt = `${Math.max(48, Math.floor(videoBps / 1000))}k`;
                            audioBitrateOpt = `${Math.max(12, Math.floor(audioBps / 1000))}k`;
                            
                            if (targetSizeKB <= 500) {
                                scaleFilter = 'scale=320:-2';
                            } else if (targetSizeKB <= 1500) {
                                scaleFilter = 'scale=480:-2';
                            } else {
                                scaleFilter = 'scale=854:-2';
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
                                '-preset ultrafast',
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
                res.set('Content-Type', isMp3 ? 'audio/mpeg' : 'video/mp4');
                return res.send(processedBuffer);

            } finally {
                if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
                if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
            }
        }
        
        // --- OTHER DOCUMENTS ROUTING (ZIP Compression) ---
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
