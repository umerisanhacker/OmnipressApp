document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const dropZonePrompt = document.getElementById('dropZonePrompt');
    const previewContainer = document.getElementById('previewContainer');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const cancelBtn = document.getElementById('cancelBtn');
    const compressBtn = document.getElementById('compressBtn');
    const targetSizeInput = document.getElementById('targetSize');
    const statusDiv = document.getElementById('status');

    if (!fileInput || !dropZone) {
        console.error("[CRITICAL] Missing essential DOM elements.");
        return;
    }

    let selectedFile = null;

    dropZone.addEventListener('click', (e) => {
        if (e.target.closest('#cancelBtn')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            selectedFile = e.target.files[0];
            showPreview(selectedFile);
        }
    });

    function showPreview(file) {
        const fileSizeKB = Math.round(file.size / 1024);
        
        if (dropZonePrompt) dropZonePrompt.classList.add('hidden');
        if (previewContainer) previewContainer.classList.remove('hidden');
        if (fileNameDisplay) fileNameDisplay.textContent = `${file.name} (${fileSizeKB} KB)`;

        if (statusDiv) {
            statusDiv.classList.add('hidden');
        }
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedFile = null;
            fileInput.value = '';

            if (previewContainer) previewContainer.classList.add('hidden');
            if (dropZonePrompt) dropZonePrompt.classList.remove('hidden');

            if (statusDiv) {
                statusDiv.classList.add('hidden');
            }
        });
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            selectedFile = files[0];
            showPreview(selectedFile);
        }
    });

    async function loadLibraries() {
        if (!window.pdfjsLib) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                script.onload = () => {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    resolve();
                };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        if (!window.PDFLib) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/pdf-lib@1.4.0/dist/pdf-lib.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
    }

    async function compressImageToTargetObject(img, targetBytes, mimeType, originalExt) {
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        
        let width = img.width;
        let height = img.height;
        let scale = 1.0;
        let bestBlob = null;
        let minDifference = Infinity;
        
        const isPng = mimeType === 'image/png' || originalExt === 'png';
        
        // Iterative downscaling loop for both lossy and lossless formats
        for (let attempt = 0; attempt < 10; attempt++) {
            let currentWidth = Math.max(30, Math.round(width * scale));
            let currentHeight = Math.max(30, Math.round(height * scale));
            canvas.width = currentWidth;
            canvas.height = currentHeight;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            if (!isPng && (mimeType === 'image/jpeg' || mimeType === 'image/webp' || originalExt === 'jpg' || originalExt === 'jpeg' || originalExt === 'webp')) {
                let low = 0.01, high = 1.0;
                let bestQualityAtThisScale = null;
                let minDiffThisScale = Infinity;

                for (let q = 0; q < 8; q++) {
                    let mid = (low + high) / 2;
                    let blob = await new Promise(res => canvas.toBlob(res, mimeType, mid));
                    if (blob) {
                        const diff = targetBytes - blob.size;
                        if (blob.size <= targetBytes) {
                            if (diff < minDiffThisScale) {
                                minDiffThisScale = diff;
                                bestQualityAtThisScale = blob;
                            }
                            low = mid;
                        } else {
                            high = mid;
                        }
                    }
                }

                if (bestQualityAtThisScale) {
                    const diffFromTarget = targetBytes - bestQualityAtThisScale.size;
                    if (diffFromTarget < minDifference) {
                        minDifference = diffFromTarget;
                        bestBlob = bestQualityAtThisScale;
                    }
                    if (diffFromTarget / targetBytes < 0.03) {
                        return { blob: bestBlob, ext: originalExt };
                    }
                }
            } else {
                let blob = await new Promise(res => canvas.toBlob(res, mimeType));
                if (blob) {
                    const diff = targetBytes - blob.size;
                    if (blob.size <= targetBytes) {
                        if (diff < minDifference) {
                            minDifference = diff;
                            bestBlob = blob;
                        }
                        if (diff / targetBytes < 0.03) {
                            return { blob: bestBlob, ext: originalExt };
                        }
                    }
                }
            }

            scale *= 0.75;
            if (width * scale < 30 || height * scale < 30) break;
        }

        if (bestBlob) {
            return { blob: bestBlob, ext: originalExt };
        }

        // Emergency fallback
        canvas.width = Math.max(30, Math.round(width * 0.15));
        canvas.height = Math.max(30, Math.round(height * 0.15));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let fallbackBlob = await new Promise(res => canvas.toBlob(res, mimeType, 0.2));
        return { blob: fallbackBlob || img, ext: originalExt };
    }

    async function compressFileClientSide(file, targetSizeKB, statusCallback) {
        await loadLibraries();
        const targetBytes = targetSizeKB * 1024;
        const extName = file.name.split('.').pop().toLowerCase();
        const isPdf = file.type === 'application/pdf' || extName === 'pdf';
        const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(extName);

        if (isPdf) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const numPages = pdfDoc.numPages;
                
                const overheadBuffer = numPages * 300;
                const effectiveTargetBytes = Math.max(targetBytes * 0.9, targetBytes - overheadBuffer);
                const targetBytesPerPage = Math.max(3072, Math.floor(effectiveTargetBytes / numPages));
                
                const compressionRatio = targetBytes / file.size;
                const renderScale = compressionRatio < 0.3 ? 0.6 : (compressionRatio < 0.6 ? 0.8 : 1.0);

                const newPdfDoc = await window.PDFLib.PDFDocument.create();

                for (let i = 1; i <= numPages; i++) {
                    if (statusCallback) {
                        const percent = Math.round((i / numPages) * 100);
                        statusCallback(`Optimizing PDF: Page ${i} of ${numPages} (${percent}%)`);
                    }

                    const page = await pdfDoc.getPage(i);
                    let viewport = page.getViewport({ scale: renderScale });
                    
                    let canvas = document.createElement('canvas');
                    let ctx = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                    let img = new Image();
                    img.src = canvas.toDataURL('image/jpeg', 0.8);
                    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

                    let result = await compressImageToTargetObject(img, targetBytesPerPage, 'image/jpeg', 'jpg');
                    
                    const imageBytes = await result.blob.arrayBuffer();
                    const embeddedImage = await newPdfDoc.embedJpg(imageBytes);
                    
                    const newPage = newPdfDoc.addPage([viewport.width, viewport.height]);
                    newPage.drawImage(embeddedImage, {
                        x: 0,
                        y: 0,
                        width: viewport.width,
                        height: viewport.height,
                    });

                    if (i % 4 === 0) {
                        await new Promise(r => setTimeout(r, 5));
                    }
                }

                if (statusCallback) statusCallback('Finalizing targeted file size packaging...');
                const pdfBytes = await newPdfDoc.save();
                return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), ext: 'pdf' };
            } catch (pdfErr) {
                console.warn("[PDF FALLBACK] Client parsing failed, switching to server engine:", pdfErr);
                throw new Error("SERVER_FALLBACK");
            }
        } else if (isImage) {
            if (statusCallback) statusCallback('Targeting precise image file size...');
            const mimeType = file.type || (extName === 'png' ? 'image/png' : 'image/jpeg');
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = async (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = async () => {
                        try {
                            const res = await compressImageToTargetObject(img, targetBytes, mimeType, extName);
                            resolve(res);
                        } catch (err) {
                            reject(err);
                        }
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        } else {
            return { blob: file, ext: extName };
        }
    }

    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert('Please select or drop a file first.');
                return;
            }

            const targetSizeVal = targetSizeInput ? parseInt(targetSizeInput.value) || 1500 : 1500;
            const extName = selectedFile.name.split('.').pop().toLowerCase();
            const isClientProcessable = selectedFile.type.startsWith('image/') || extName === 'pdf' || ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(extName);

            if (statusDiv) {
                statusDiv.classList.remove('hidden');
                statusDiv.textContent = 'Initializing target size optimization...';
                statusDiv.style.color = '#007bff';
            }

            const updateStatus = (msg) => {
                if (statusDiv) {
                    statusDiv.textContent = msg;
                }
            };

            try {
                let blob, finalExt;

                if (isClientProcessable) {
                    try {
                        const result = await compressFileClientSide(selectedFile, targetSizeVal, updateStatus);
                        blob = result.blob;
                        finalExt = result.ext;
                    } catch (clientErr) {
                        if (clientErr.message === "SERVER_FALLBACK") {
                            updateStatus('Switching to server fallback engine...');
                            const formData = new FormData();
                            formData.append('file', selectedFile);
                            formData.append('targetSize', targetSizeVal);

                            const response = await fetch('/api/compress/universal', {
                                method: 'POST',
                                body: formData
                            });

                            if (!response.ok) {
                                let errorMessage = 'Compression failed on server.';
                                try {
                                    const errData = await response.json();
                                    errorMessage = errData.error || errorMessage;
                                } catch (e) {}
                                throw new Error(errorMessage);
                            }

                            blob = await response.blob();
                            finalExt = 'zip';
                        } else {
                            throw clientErr;
                        }
                    }
                } else {
                    updateStatus('Processing file via server engine...');
                    const formData = new FormData();
                    formData.append('file', selectedFile);
                    formData.append('targetSize', targetSizeVal);

                    const response = await fetch('/api/compress/universal', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        let errorMessage = 'Compression failed on server.';
                        try {
                            const errData = await response.json();
                            errorMessage = errData.error || errorMessage;
                        } catch (e) {}
                        throw new Error(errorMessage);
                    }

                    blob = await response.blob();
                    finalExt = extName;
                }

                const downloadUrl = window.URL.createObjectURL(blob);
                const baseName = selectedFile.name.includes('.') 
                    ? selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.')) 
                    : selectedFile.name;
                const finalDownloadName = finalExt === 'zip' ? `${baseName}-compressed.zip` : `${baseName}.${finalExt}`;

                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = finalDownloadName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(downloadUrl);

                if (statusDiv) {
                    statusDiv.textContent = `Success! Downloaded file size: ~${Math.round(blob.size / 1024)} KB (Target: ${targetSizeVal} KB).`;
                    statusDiv.style.color = '#28a745';
                }
            } catch (err) {
                console.error(`[COMPRESSION ERROR]`, err);
                if (statusDiv) {
                    statusDiv.classList.remove('hidden');
                    statusDiv.textContent = `Error: ${err.message}`;
                    statusDiv.style.color = '#dc3545';
                }
                alert(err.message);
            }
        });
    }
});
