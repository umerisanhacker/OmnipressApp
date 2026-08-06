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

    if (!fileInput || !dropZone) return;

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
        if (statusDiv) statusDiv.classList.add('hidden');
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedFile = null;
            fileInput.value = '';
            if (previewContainer) previewContainer.classList.add('hidden');
            if (dropZonePrompt) dropZonePrompt.classList.remove('hidden');
            if (statusDiv) statusDiv.classList.add('hidden');
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

    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert('Please select or drop a file first.');
                return;
            }

            const targetSizeVal = targetSizeInput ? parseInt(targetSizeInput.value) || 1500 : 1500;

            if (statusDiv) {
                statusDiv.classList.remove('hidden');
                statusDiv.textContent = 'Sending to Render Ghostscript Engine...';
                statusDiv.style.color = '#007bff';
            }

            try {
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

                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const originalName = selectedFile.name;
                const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
                const ext = originalName.split('.').pop().toLowerCase();
                
                const finalDownloadName = `OmniPress-${baseName}.${ext}`;

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
