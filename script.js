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

    // Advanced Multi-Pass Client-Side Image Compressor to hit strict Target KB
    async function compressImageClientSide(file, targetSizeKB, format) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = async () => {
                    const targetBytes = targetSizeKB * 1024;
                    let width = img.width;
                    let height = img.height;
                    
                    let mimeType = 'image/jpeg';
                    let ext = 'jpg';
                    if (format === 'png' || file.type === 'image/png') {
                        mimeType = 'image/png';
                        ext = 'png';
                    } else if (format === 'webp') {
                        mimeType = 'image/webp';
                        ext = 'webp';
                    } else if (format === 'avif') {
                        mimeType = 'image/avif';
                        ext = 'avif';
                    }

                    let canvas = document.createElement('canvas');
                    let ctx = canvas.getContext('2d');

                    let scale = 1.0;
                    let bestBlob = null;

                    // If file is already smaller than target, keep original
                    if (file.size <= targetBytes) {
                        canvas.width = width;
                        canvas.height = height;
                        ctx.drawImage(img, 0, 0, width, height);
                        canvas.toBlob((blob) => {
                            resolve({ blob: blob || file, ext });
                        }, mimeType, 0.9);
                        return;
                    }

                    // Iteratively scale down dimensions and reduce quality until we hit the target size
                    for (let attempt = 0; attempt < 6; attempt++) {
                        let currentWidth = Math.max(80, Math.round(width * scale));
                        let currentHeight = Math.max(80, Math.round(height * scale));
                        
                        canvas.width = currentWidth;
                        canvas.height = currentHeight;
                        ctx.clearRect(0, 0, currentWidth, currentHeight);
                        ctx.drawImage(img, 0, 0, currentWidth, currentHeight);

                        for (let q = 0.85; q >= 0.1; q -= 0.15) {
                            const blob = await new Promise(res => canvas.toBlob(res, mimeType, q));
                            if (blob) {
                                bestBlob = blob;
                                if (blob.size <= targetBytes) {
                                    resolve({ blob, ext });
                                    return;
                                }
                            }
                        }
                        scale *= 0.65; // Aggressively scale down dimensions if still too large
                    }

                    resolve({ blob: bestBlob || file, ext });
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    }

    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert('Please select or drop a file first.');
                return;
            }

            const chosenFormat = formatSelect ? formatSelect.value : 'auto';
            const targetSizeVal = targetSizeInput ? parseInt(targetSizeInput.value) || 1500 : 1500;
            const isImage = selectedFile.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(selectedFile.name.split('.').pop().toLowerCase());

            if (statusDiv) {
                statusDiv.classList.remove('hidden');
                statusDiv.textContent = 'Processing and compressing file... Please wait.';
                statusDiv.style.color = '#007bff';
            }

            try {
                let blob, finalExt;

                if (isImage) {
                    const result = await compressImageClientSide(selectedFile, targetSizeVal, chosenFormat);
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
                    finalExt = chosenFormat !== 'auto' ? chosenFormat : selectedFile.name.split('.').pop();
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
