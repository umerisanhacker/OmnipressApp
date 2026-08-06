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
    }

    // Handle remove/cancel file button
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

    // Handle compression request submission with robust error handling and correct extension mapping
    if (compressBtn) {
        compressBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert('Please select or drop a file first.');
                return;
            }

            const formData = new FormData();
            formData.append('file', selectedFile);
            
            const chosenFormat = formatSelect ? formatSelect.value : 'auto';
            formData.append('outputFormat', chosenFormat);
            formData.append('targetSize', targetSizeInput ? targetSizeInput.value : '1500');

            if (statusDiv) {
                statusDiv.classList.remove('hidden');
                statusDiv.textContent = 'Processing and compressing file... Please wait.';
                statusDiv.style.color = '#007bff';
            }

            // Set up a 90-second timeout controller so the UI never hangs indefinitely
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000);

            try {
                const response = await fetch('/api/compress/universal', {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

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
                
                // Dynamically determine correct file extension based on user selection
                let outputExtension = selectedFile.name.split('.').pop();
                if (chosenFormat && chosenFormat !== 'auto') {
                    outputExtension = chosenFormat;
                }
                const baseName = selectedFile.name.includes('.') 
                    ? selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.')) 
                    : selectedFile.name;
                const finalDownloadName = `${baseName}.${outputExtension}`;

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
                clearTimeout(timeoutId);
                console.error(`[COMPRESSION ERROR]`, err);
                
                let displayMsg = err.message;
                if (err.name === 'AbortError') {
                    displayMsg = 'Request timed out. The file might be too large or complex for the server.';
                }

                if (statusDiv) {
                    statusDiv.classList.remove('hidden');
                    statusDiv.textContent = `Error: ${displayMsg}`;
                    statusDiv.style.color = '#dc3545';
                }
                alert(displayMsg);
            }
        });
    }
});
