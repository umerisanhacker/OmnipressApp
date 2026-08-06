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
        canvas.width = width;
        canvas.height = height;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let bestBlob = null;
        let currentQuality = 0.90;

        // Phase 1: High-clarity, aggressive quality reduction
        while (currentQuality >= 0.35) {
            let blob = await new Promise(res => canvas.toBlob(res, mimeType, currentQuality));
            if (blob) {
                bestBlob = blob;
                if (blob.size <= targetBytes) {
                    break;
                }
            }
            currentQuality -= 0.05;
        }

        // Phase 2: Gentle scaling only if absolutely needed
        if (bestBlob && bestBlob.size > targetBytes) {
            let scale = 0.95;
            for (let i = 0; i < 5; i++) {
                if (scale < 0.50) break;
                
                let targetW = Math.round(width * scale);
                let targetH = Math.round(height * scale);
                canvas.width = targetW;
                canvas.height = targetH;
                
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, targetW, targetH);
                ctx.drawImage(img, 0, 0, targetW, targetH);

                let blob = await new Promise(res => canvas.toBlob(res, mimeType, 0.60));
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
                if (statusCallback) statusCallback('Optimizing PDF structure (Preserving 100% Vector Clarity)...');
                const arrayBuffer = await file.arrayBuffer();
                
                // Natively load the PDF without turning it into a blurry image
                const pdfDoc = await window.PDFLib.PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

                // Re-save using native object stream compression to strip bloat
                const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
                let finalBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                
                // Absolute guardrail: If the "compressed" version is bigger, revert to original
                if (finalBlob.size >= file.size) {
                    console.log("Native compression did not yield smaller size. Using original to prevent bloat.");
                    finalBlob = file;
                }

                // If it's still way over the target size, route it to the server for ZIP archiving
                if (finalBlob.size > targetBytes * 1.5) {
                    throw new Error("SERVER_FALLBACK");
                }

                if (statusCallback) statusCallback('Finalizing perfect-clarity document...');
                return { blob: finalBlob, ext: 'pdf' };

            } catch (pdfErr) {
                console.warn("[PDF FALLBACK] Routing to server archiver:", pdfErr);
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
                statusDiv.textContent = 'Initializing optimization...';
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
                            updateStatus('Document cannot be structurally shrunk further. Zipping via server...');
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
                            finalExt = 'zip'; // Server fallback for documents returns ZIP
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
                    finalExt = extName; // Server media routing keeps ext
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
                    statusDiv.textContent = `Success! Downloaded file size: ~${Math.round(blob.size / 1024)} KB.`;
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
