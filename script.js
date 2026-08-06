document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const compressBtn = document.getElementById('compressBtn');
    const formatSelect = document.getElementById('outputFormat');
    const targetSizeInput = document.getElementById('targetSize');
    const statusDiv = document.getElementById('status');

    if (!fileInput) {
        console.error("[CRITICAL] Missing fileInput element in HTML.");
        return;
    }

    let selectedFile = null;

    // Handle file selection via native file explorer dialog
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            selectedFile = e.target.files[0];
            updateFileUI(selectedFile);
            fileInput.value = ''; // Reset so the same file can be chosen again if needed
        }
    });

    // Prevent default behaviors for drag and drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => {
            dropZone.classList.remove('dragover');
        }, false);
    });

    // Handle dropped files
    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            selectedFile = files[0];
            updateFileUI(selectedFile);
        }
    });

    function updateFileUI(file) {
        const fileSizeKB = Math.round(file.size / 1024);
        console.log(`[UI SUCCESS] File loaded: ${file.name} (${fileSizeKB} KB)`);
        
        if (statusDiv) {
            statusDiv.classList.remove('hidden');
            statusDiv.textContent = `Ready to compress: ${file.name} (${fileSizeKB} KB)`;
            statusDiv.style.color = '#28a745';
        }
    }

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
                    statusDiv.textContent = `Error: ${err.message}`;
                    statusDiv.style.color = '#dc3545';
                }
                alert(err.message);
            }
        });
    }
});
