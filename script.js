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

    // Make clicking the drop zone open the file explorer reliably
    dropZone.addEventListener('click', (e) => {
        // If the user clicked the remove button, do not trigger file picker
        if (e.target.closest('#cancelBtn')) return;
        fileInput.click();
    });

    // Handle file selection via file explorer
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
        console.log(`[UI SUCCESS] File loaded: ${file.name}`);
    }

    // Handle remove/cancel file button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent opening file picker again

            selectedFile = null;
            fileInput.value = ''; // Reset input

            if (previewContainer) previewContainer.classList.add('hidden');
            if (dropZonePrompt) dropZonePrompt.classList.remove('hidden');

            if (statusDiv) {
                statusDiv.classList.add('hidden');
            }
            console.log(`[UI] File removed.`);
        });
    }

    // Drag and drop handlers
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

    // Handle compression request submission
    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert('Please select or drop a file first.');
                return;
            }

            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('outputFormat', formatSelect ? formatSelect.value : 'auto');
            formData.append('targetSize', targetSizeInput ? targetSizeInput.value : '1500');

            if (statusDiv) {
                statusDiv.classList.remove('hidden');
                statusDiv.textContent = 'Processing and compressing file... Please wait.';
                statusDiv.style.color = '#007bff';
            }

            try {
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
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = selectedFile.name;
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
