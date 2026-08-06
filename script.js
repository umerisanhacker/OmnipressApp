document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const dropZonePrompt = document.getElementById('dropZonePrompt');
    const previewContainer = document.getElementById('previewContainer');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const cancelBtn = document.getElementById('cancelBtn');
    const compressBtn = document.getElementById('compressBtn');
    const formatSelect = document.getElementById('outputFormat');
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

    async function renderPdfToCanvas(file) {
        await loadLibraries();
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        const page = await pdfDoc.getPage(1);
        
        let viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        return canvas;
    }

    async function getBlobWithQuality(canvas, mimeType, quality) {
        return new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    }

    async function compressFileClientSide(file, targetSizeKB, format) {
        const targetBytes = targetSizeKB * 1024;
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');

        if (isPdf) {
            canvas = await renderPdfToCanvas(file);
        } else {
            await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        canvas.width = img.width;
                        canvas.height = img.height;
                        ctx.drawImage(img, 0, 0);
                        resolve();
                    };
                    img.onerror = reject;
                };
                reader.onerror = reject;
            });
        }

        let mimeType = 'image/jpeg';
        let ext = isPdf ? 'pdf' : 'jpg';

        if (!isPdf) {
            if (format === 'png' || file.type === 'image/png') {
                mimeType = 'image/png';
                ext = 'png';
            } else if (format === 'webp') {
                mimeType = 'image/webp';
                ext = 'webp';
            } else if (format === 'avif') {
                mimeType = 'image/avif';
                ext = 'avif';
            } else {
                mimeType = 'image/jpeg';
                ext = 'jpg';
            }
        }

        let scale = 1.0;
        let bestBlob = null;

        for (let attempt = 0; attempt < 8; attempt++) {
            let currentWidth = Math.max(100, Math.round(canvas.width * scale));
            let currentHeight = Math.max(100, Math.round(canvas.height * scale));
            
            let tempCanvas = document.createElement('canvas');
            tempCanvas.width = currentWidth;
            tempCanvas.height = currentHeight;
            let tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(canvas, 0, 0, currentWidth, currentHeight);

            if (mimeType === 'image/png' && !isPdf) {
                const blob = await getBlobWithQuality(tempCanvas, mimeType, 1.0);
                if (blob) {
                    bestBlob = blob;
                    if (blob.size <= targetBytes) {
                        return { blob, ext };
                    }
                }
                scale *= 0.75;
            } else {
                let low = 0.05;
                let high = 1.0;
                let optimalBlob = null;

                let maxBlob = await getBlobWithQuality(tempCanvas, mimeType, high);
                if (maxBlob && maxBlob.size <= targetBytes && !isPdf) {
                    return { blob: maxBlob, ext };
                }

                for (let step = 0; step < 6; step++) {
                    let mid = (low + high) / 2;
                    let candidateBlob = await getBlobWithQuality(tempCanvas, mimeType, mid);
                    
                    if (candidateBlob) {
                        if (candidateBlob.size <= targetBytes) {
                            optimalBlob = candidateBlob;
                            low = mid;
                        } else {
                            high = mid;
                        }
                    }
                }

                if (optimalBlob) {
                    bestBlob = optimalBlob;
                    if (!isPdf) return { blob: bestBlob, ext };
                    break;
                } else {
                    bestBlob = await getBlobWithQuality(tempCanvas, mimeType, low);
                }
            }

            scale *= 0.80;
        }

        // If it's a PDF, wrap the compressed image back into a clean PDF container using pdf-lib
        if (isPdf && bestBlob) {
            await loadLibraries();
            const pdfDoc = await window.PDFLib.PDFDocument.create();
            const page = pdfDoc.addPage([canvas.width, canvas.height]);
            
            const imageBytes = await bestBlob.arrayBuffer();
            const embeddedImage = await pdfDoc.embedJpg(imageBytes);
            
            page.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: canvas.width,
                height: canvas.height,
            });

            const pdfBytes = await pdfDoc.save();
            const finalPdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
            return { blob: finalPdfBlob, ext: 'pdf' };
        }

        return { blob: bestBlob || file, ext };
    }

    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert('Please select or drop a file first.');
                return;
            }

            const chosenFormat = formatSelect ? formatSelect.value : 'auto';
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
                    const result = await compressFileClientSide(selectedFile, targetSizeVal, chosenFormat);
                    blob = result.blob;
                    finalExt = result.ext;
                } else {
                    const formData = new FormData();
                    formData.append('file', selectedFile);
                    formData.append('outputFormat', chosenFormat);
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
                    finalExt = chosenFormat !== 'auto' ? chosenFormat : extName;
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
