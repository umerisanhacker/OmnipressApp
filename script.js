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

    // Dynamically load external libraries (PDF.js, PDF-Lib, JSZip)
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
        if (!window.JSZip) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
    }

    async function getBlobWithQuality(canvas, mimeType, quality) {
        return new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    }

    // Helper for binary search quality optimization on canvas
    async function compressCanvasToTarget(canvas, mimeType, targetBytes) {
        let low = 0.05;
        let high = 1.0;
        let optimalBlob = null;

        let maxBlob = await getBlobWithQuality(canvas, mimeType, high);
        if (maxBlob && maxBlob.size <= targetBytes) return maxBlob;

        for (let step = 0; step < 6; step++) {
            let mid = (low + high) / 2;
            let candidateBlob = await getBlobWithQuality(canvas, mimeType, mid);
            
            if (candidateBlob) {
                if (candidateBlob.size <= targetBytes) {
                    optimalBlob = candidateBlob;
                    low = mid;
                } else {
                    high = mid;
                }
            }
        }
        return optimalBlob || await getBlobWithQuality(canvas, mimeType, low);
    }

    async function compressFileClientSide(file, targetSizeKB, format) {
        await loadLibraries();
        const targetBytes = targetSizeKB * 1024;
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImageExportFormat = ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(format);

        // If user wants to export a multi-page PDF into individual image pages packed in a ZIP
        if (isPdf && isImageExportFormat) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdfDoc.numPages;
            
            const zip = new window.JSZip();
            const perPageTargetBytes = Math.max(15000, Math.floor(targetBytes / numPages));

            let mimeType = 'image/jpeg';
            let ext = format;
            if (ext === 'png') mimeType = 'image/png';
            if (ext === 'webp') mimeType = 'image/webp';
            if (ext === 'avif') mimeType = 'image/avif';

            for (let i = 1; i <= numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                let pageBlob = await compressCanvasToTarget(canvas, mimeType, perPageTargetBytes);
                const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || 'document';
                zip.file(`${baseName}_page_${i}.${ext}`, pageBlob);
            }

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            return { blob: zipBlob, ext: 'zip' };
        }

        // Single-page PDF or Standard PDF compression back to PDF
        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');

        if (isPdf) {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const page = await pdfDoc.getPage(1);
            let viewport = page.getViewport({ scale: 2.0 });
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
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

        if (!isPdf && format !== 'auto') {
            ext = format;
            if (format === 'png') mimeType = 'image/png';
            if (format === 'webp') mimeType = 'image/webp';
            if (format === 'avif') mimeType = 'image/avif';
        }

        let bestBlob = await compressCanvasToTarget(canvas, mimeType, targetBytes);

        if (isPdf && (ext === 'pdf' || format === 'auto')) {
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
            return { blob: new Blob([pdfBytes], { type: 'application/pdf' }), ext: 'pdf' };
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
