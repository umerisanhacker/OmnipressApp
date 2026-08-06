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

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentFile) {
            showStatus('Please select a file first.', 'error');
            return;
        }

        const targetSize = document.getElementById('targetSize').value;
        const outputFormat = document.getElementById('outputFormat').value;
        
        const formData = new FormData();
        formData.append('file', currentFile);
        formData.append('targetSize', targetSize);
        formData.append('outputFormat', outputFormat);

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
        showStatus('Uploading and processing file... Please wait.', 'success');

        try {
            // Change this line in frontend/script.js:
const response = await fetch('/api/compress/universal', {
    method: 'POST',
    body: formData
});

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server processing failed.');
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