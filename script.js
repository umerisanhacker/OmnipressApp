document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const dropZonePrompt = document.getElementById('dropZonePrompt');
    const previewContainer = document.getElementById('previewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const fileIconPreview = document.getElementById('fileIconPreview');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const cancelBtn = document.getElementById('cancelBtn');
    const uploadForm = document.getElementById('uploadForm');
    const submitBtn = document.getElementById('submitBtn');
    const statusMessage = document.getElementById('statusMessage');

    let currentFile = null;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.style.borderColor = '#65a30d', false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.style.borderColor = 'rgba(255,255,255,0.3)', false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    dropZone.addEventListener('click', (e) => {
        if (e.target !== cancelBtn) fileInput.click();
    });

    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        if (files.length > 0) {
            currentFile = files[0];
            dropZonePrompt.classList.add('hidden');
            previewContainer.classList.remove('hidden');
            fileNameDisplay.textContent = currentFile.name;

            if (currentFile.type.startsWith('image/')) {
                fileIconPreview.classList.add('hidden');
                imagePreview.classList.remove('hidden');
                const reader = new FileReader();
                reader.onload = (e) => { imagePreview.src = e.target.result; }
                reader.readAsDataURL(currentFile);
            } else if (currentFile.type.startsWith('video/')) {
                imagePreview.classList.add('hidden');
                fileIconPreview.classList.remove('hidden');
                fileIconPreview.textContent = '🎥';
            } else if (currentFile.type === 'application/pdf' || currentFile.name.endsWith('.pdf')) {
                imagePreview.classList.add('hidden');
                fileIconPreview.classList.remove('hidden');
                fileIconPreview.textContent = '📚';
            } else if (currentFile.name.endsWith('.zip') || currentFile.name.endsWith('.rar')) {
                imagePreview.classList.add('hidden');
                fileIconPreview.classList.remove('hidden');
                fileIconPreview.textContent = '🗜️';
            } else {
                imagePreview.classList.add('hidden');
                fileIconPreview.classList.remove('hidden');
                fileIconPreview.textContent = '📄';
            }
        }
    }

    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentFile = null;
        fileInput.value = '';
        previewContainer.classList.add('hidden');
        dropZonePrompt.classList.remove('hidden');
        imagePreview.src = '';
        statusMessage.className = 'hidden';
    });

    // Helper function for quick browser-side image compression to speed up uploads
    async function compressImageClientSide(file) {
        if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    const MAX_DIMENSION = 1920;
                    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                        if (width > height) {
                            height = Math.round((height * MAX_DIMENSION) / width);
                            width = MAX_DIMENSION;
                        } else {
                            width = Math.round((width * MAX_DIMENSION) / height);
                            height = MAX_DIMENSION;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (!blob) {
                            resolve(file);
                            return;
                        }
                        const optimizedFile = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(optimizedFile);
                    }, 'image/jpeg', 0.85);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentFile) {
            showStatus('Please select a file first.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
        showStatus('Preparing file... Please wait.', 'success');

        try {
            let fileToSend = currentFile;
            if (currentFile.type.startsWith('image/')) {
                showStatus('Quick-compressing image in browser...', 'success');
                fileToSend = await compressImageClientSide(currentFile);
            }

            const targetSize = document.getElementById('targetSize').value;
            const outputFormat = document.getElementById('outputFormat').value;
            
            const formData = new FormData();
            formData.append('file', fileToSend);
            formData.append('targetSize', targetSize);
            formData.append('outputFormat', outputFormat);

            showStatus('Uploading and processing file... Please wait.', 'success');

            const response = await fetch('/api/compress/universal', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let errorMessage = 'Server processing failed.';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (parseErr) {
                    const errorText = await response.text();
                    if (errorText) errorMessage = errorText;
                }
                throw new Error(errorMessage);
            }

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = downloadUrl;
            
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `compressed-${currentFile.name}`;
            if (contentDisposition && contentDisposition.indexOf('filename=') !== -1) {
                filename = contentDisposition.split('filename=')[1].replace(/"/g, '');
            }
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            
            showStatus('File processed and downloaded successfully!', 'success');
        } catch (error) {
            showStatus(`Error: ${error.message}`, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Process & Download File';
        }
    });

    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = type;
        statusMessage.classList.remove('hidden');
    }

    const accordions = document.querySelectorAll('.accordion-btn');
    accordions.forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.toggle('active');
            const content = this.nextElementSibling;
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
            } else {
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    });
});
