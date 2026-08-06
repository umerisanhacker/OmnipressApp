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

    // THE RELENTLESS TARGETING ENGINE
    async function compressImageToTargetObject(img, targetBytes, mimeType, originalExt, isDocument = false) {
        let bestBlob = null;
        
        // Start documents at 1.4x scale for clarity, standard images at 1.0x
        let scale = isDocument ? 1.4 : 1.0; 
        const minQuality = 0.10; // We will go deep into JPEG compression before ruining resolution
        
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');

        // Loop until we mathematically force the file below the target bytes
        while (scale >= 0.25) { 
            let targetW = Math.round(img.width * scale);
            let targetH = Math.round(img.height * scale);
            canvas.width = targetW;
            canvas.height = targetH;
            
            // Solid white background is crucial for docs to avoid massive black transparent artifacts
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, targetW, targetH);
            ctx.drawImage(img, 0, 0, targetW, targetH);

            let currentQuality = 0.85;
            
            while (currentQuality >= minQuality) {
                let blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', currentQuality));
                bestBlob = blob;
                
                if (blob.size <= targetBytes) {
                    return { blob: bestBlob, ext: originalExt }; // Target Hit. Exit loop.
                }
                // Drop quality in aggressive chunks to save resolution
                currentQuality -= 0.15; 
            }
            
            // If lowest quality STILL missed the target, we have no choice but to shrink physical dimensions.
            scale -= 0.20; 
        }

        // If we exhausted every possible drop, return the absolute smallest it could mathematically get
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
                
                // Reserve 8% of the target size for PDF wrapper/metadata overhead
                const safeTargetBytes = targetBytes * 0.92; 
                const targetBytesPerPage = Math.floor(safeTargetBytes / numPages);
                
                if (statusCallback) statusCallback(`Strict Allocation: ~${Math.round(targetBytesPerPage/1024)}KB per page...`);
                
                const newPdfDoc = await window.PDFLib.PDFDocument.create();

                for (let i = 1; i <= numPages; i++) {
                    if (statusCallback) {
                        const percent = Math.round((i / numPages) * 100);
                        statusCallback(`Forcing Target Size: Processing page ${i}/${numPages} (${percent}%)`);
                    }

                    const page = await pdfDoc.getPage(i);
                    // Start render at base 1.0. The Relentless Engine will upscale/downscale it.
                    let viewport = page.getViewport({ scale: 1.0 }); 
                    
                    let canvas = document.createElement('canvas');
                    let ctx = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    
                    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                    let img = new Image();
                    img.src = canvas.toDataURL('image/jpeg', 1.0);
                    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

                    // Execute the relentless compressor
                    let result = await compressImageToTargetObject(img, targetBytesPerPage, 'image/jpeg', 'jpg', true);
                    
                    const imageBytes = await result.blob.arrayBuffer();
                    const embeddedImage = await newPdfDoc.embedJpg(imageBytes);
                    
                    const origViewport = page.getViewport({ scale: 1.0 });
                    const newPage = newPdfDoc.addPage([origViewport.width, origViewport.height]);
                    newPage.drawImage(embeddedImage, {
                        x: 0,
                        y: 0,
                        width: origViewport.width,
                        height: origViewport.height,
                    });

                    // Aggressive memory cleanup to prevent browser crash on heavy books
                    page.cleanup();
                    canvas.width = 0;
                    canvas.height = 0;
                    img.src = '';
                    img = null;

                    // Brief pause to keep the UI from locking up completely
                    if (i % 3 === 0) {
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                }

                if (statusCallback) statusCallback('Finalizing strict file size packaging...');
                const pdfBytes = await newPdfDoc.save();
                return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), ext: 'pdf' };

            } catch (pdfErr) {
                console.warn("[PDF CRITICAL] Client parsing failed, routing to server:", pdfErr);
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
                statusDiv.textContent = 'Initializing precision optimization...';
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
                            updateStatus('Pushing to server fallback engine...');
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
                    const finalSizeKB = Math.round(blob.size / 1024);
                    statusDiv.textContent = `Success! Downloaded file size: ~${finalSizeKB} KB (Target: ${targetSizeVal} KB).`;
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
