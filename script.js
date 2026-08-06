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
        
        const isPng = mimeType === 'image/png';
        
        // Iteratively downscale dimensions and reduce quality until target size is achieved
        for (let attempt = 0; attempt < 8; attempt++) {
            canvas.width = Math.max(20, Math.round(width * scale));
            canvas.height = Math.max(20, Math.round(height * scale));
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            if (!isPng && (mimeType === 'image/jpeg' || mimeType === 'image/webp')) {
                let low = 0.05, high = 1.0;
                for (let q = 0; q < 5; q++) {
                    let mid = (low + high) / 2;
                    let blob = await new Promise(res => canvas.toBlob(res, mimeType, mid));
                    if (blob) {
                        bestBlob = blob;
                        if (blob.size <= targetBytes) {
                            return { blob, ext: originalExt };
                        }
                        if (blob.size > targetBytes) {
                            high = mid;
                        } else {
                            low = mid;
                        }
                    }
                }
            } else {
                let blob = await new Promise(res => canvas.toBlob(res, mimeType));
                if (blob) {
                    bestBlob = blob;
                    if (blob.size <= targetBytes) {
                        return { blob, ext: originalExt };
                    }
                }
            }

            scale *= 0.8; // Reduce dimensions by 20% each loop iteration
        }

        if (bestBlob) {
            return { blob: bestBlob, ext: originalExt };
        }

        // Ultimate fallback
        canvas.width = Math.max(20, Math.round(width * 0.2));
        canvas.height = Math.max(20, Math.round(height * 0.2));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let fallbackBlob = await new Promise(res => canvas.toBlob(res, mimeType, 0.5));
        return { blob: fallbackBlob || img, ext: originalExt };
    }

    async function compressFileClientSide(file, targetSizeKB) {
        await loadLibraries();
        const targetBytes = targetSizeKB * 1024;
        const extName = file.name.split('.').pop().toLowerCase();
        const isPdf = file.type === 'application/pdf' || extName === 'pdf';
        const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(extName);

        if (isPdf) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const page = await pdfDoc.getPage(1);
            let viewport = page.getViewport({ scale: 1.5 });
            
            let canvas = document.createElement('canvas');
            let ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            let img = new Image();
            img.src = canvas.toDataURL('image/jpeg', 0.9);
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

            let result = await compressImageToTargetObject(img, targetBytes, 'image/jpeg', 'jpg');
            
            const newPdfDoc = await window.PDFLib.PDFDocument.create();
            const newPage = newPdfDoc.addPage([canvas.width, canvas.height]);
            const imageBytes = await result.blob.arrayBuffer();
            const embeddedImage = await newPdfDoc.embedJpg(imageBytes);
            
            newPage.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: canvas.width,
                height: canvas.height,
            });

            const pdfBytes = await newPdfDoc.save();
            return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), ext: 'pdf' };
        } else if (isImage) {
            const mimeType = file.type || 'image/jpeg';
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
                statusDiv.textContent = 'Processing and compressing file to target size... Please wait.';
                statusDiv.style.color = '#007bff';
            }

            try {
                let blob, finalExt;

                if (isClientProcessable) {
                    const result = await compressFileClientSide(selectedFile, targetSizeVal);
                    blob = result.blob;
                    finalExt = result.ext;
                } else {
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
                const finalDownloadName = `${baseName}.${finalExt}`;

                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = finalDownloadName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(downloadUrl);

                if (statusDiv) {
                    statusDiv.textContent = 'Success! Your compressed file has been downloaded.';
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
