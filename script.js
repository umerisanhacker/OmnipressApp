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

    // UPDATED: isDocument flag strictly protects text from dimension scaling
    async function compressImageToTargetObject(img, targetBytes, mimeType, originalExt, isDocument = false) {
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        
        let width = img.width;
        let height = img.height;
        canvas.width = width;
        canvas.height = height;
        
        // Fill white background to avoid transparent black-box issues in JPEG
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let bestBlob = null;
        let currentQuality = 0.90;
        
        // Documents text relies on resolution, not JPEG quality. We can drop quality heavily.
        const minQuality = isDocument ? 0.25 : 0.35;

        // Phase 1: High-clarity, aggressive quality reduction (leaves vectors sharp)
        while (currentQuality >= minQuality) {
            let blob = await new Promise(res => canvas.toBlob(res, mimeType, currentQuality));
            if (blob) {
                bestBlob = blob;
                if (blob.size <= targetBytes) {
                    break;
                }
            }
            currentQuality -= 0.05;
        }

        // Phase 2: Gentle scaling ONLY if absolutely needed. Documents resist this heavily.
        if (bestBlob && bestBlob.size > targetBytes) {
            let scale = 0.95;
            const minScale = isDocument ? 0.70 : 0.50; // Protect text dimensions
            const maxSteps = isDocument ? 3 : 5;
            
            for (let i = 0; i < maxSteps; i++) {
                if (scale < minScale) break;
                
                let targetW = Math.round(width * scale);
                let targetH = Math.round(height * scale);
                canvas.width = targetW;
                canvas.height = targetH;
                
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, targetW, targetH);
                ctx.drawImage(img, 0, 0, targetW, targetH);

                let blob = await new Promise(res => canvas.toBlob(res, mimeType, isDocument ? 0.30 : 0.60));
                if (blob) {
                    bestBlob = blob;
                    if (blob.size <= targetBytes) break;
                }
                scale -= 0.1;
            }
        }

        return { blob: bestBlob || img, ext: originalExt };
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
                
                // THE CLARITY FIX: Hard-lock supersampled resolution to keep text crisp.
                const renderScale = 1.6; 
                
                // Set a floor of ~12KB per page. Below this, physics dictates text becomes unreadable.
                const targetBytesPerPage = Math.max(12288, Math.floor((targetBytes * 0.9) / numPages));
                const newPdfDoc = await window.PDFLib.PDFDocument.create();

                for (let i = 1; i <= numPages; i++) {
                    if (statusCallback) {
                        const percent = Math.round((i / numPages) * 100);
                        statusCallback(`Enhancing Clarity & Optimizing PDF: Page ${i} of ${numPages} (${percent}%)`);
                    }

                    const page = await pdfDoc.getPage(i);
                    let viewport = page.getViewport({ scale: renderScale });
                    
                    let canvas = document.createElement('canvas');
                    let ctx = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                    let img = new Image();
                    img.src = canvas.toDataURL('image/jpeg', 1.0);
                    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

                    // Pass `true` for `isDocument` to trigger clarity-protection logic
                    let result = await compressImageToTargetObject(img, targetBytesPerPage, 'image/jpeg', 'jpg', true);
                    
                    const imageBytes = await result.blob.arrayBuffer();
                    const embeddedImage = await newPdfDoc.embedJpg(imageBytes);
                    
                    // Stamp back onto original exact physical page dimensions
                    const origViewport = page.getViewport({ scale: 1.0 });
                    const newPage = newPdfDoc.addPage([origViewport.width, origViewport.height]);
                    newPage.drawImage(embeddedImage, {
                        x: 0,
                        y: 0,
                        width: origViewport.width,
                        height: origViewport.height,
                    });

                    // MEMORY CRASH PROTECTION: Destroy heavy canvas/image data immediately for massive PDFs
                    page.cleanup();
                    canvas.width = 0;
                    canvas.height = 0;
                    img.src = '';
                    img = null;

                    if (i % 3 === 0) {
                        await new Promise(r => setTimeout(r, 10)); 
                    }
                }

                if (statusCallback) statusCallback('Finalizing high-clarity document packaging...');
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
                            const res = await compressImageToTargetObject(img, targetBytes, mimeType, extName, false);
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
                            finalExt = extName;
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
