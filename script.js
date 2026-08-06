document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const compressBtn = document.getElementById('compressBtn');
    const formatSelect = document.getElementById('outputFormat');
    const targetSizeInput = document.getElementById('targetSize');
    const statusDiv = document.getElementById('status');

    if (!dropZone || !fileInput) {
        console.error("[CRITICAL] Missing dropZone or fileInput elements in HTML.");
        return;
    }

    let selectedFile = null;

    // Trigger hidden file input when clicking the drop zone
    dropZone.addEventListener('click', (e) => {
        // Prevent triggering twice if clicking directly on elements inside dropzone
        if (e.target !== fileInput) {
            fileInput.click();
        }
    });

    // Handle file selection via browse dialog
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            selectedFile = e.target.files[0];
            updateFileUI(selectedFile);
            
            // CRITICAL FIX: Reset input value so the same file can be re-selected if needed
            fileInput.value = '';
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
        console.log(`[UI SUCCESS] File loaded into memory: ${file.name} (${fileSizeKB} KB)`);
        
        if (statusDiv) {
            statusDiv.textContent = `Ready to compress: ${file.name} (${fileSizeKB} KB)`;
            statusDiv.style.color = '#28a745';
        } else {
            // Fallback alert if status element is missing from HTML
            console.warn("[UI WARNING] #status element missing from HTML. File is ready though.");
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
});    ['dragenter', 'dragover'].forEach(eventName => {
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
        if (files.length > 0) {
            selectedFile = files[0];
            updateFileUI(selectedFile);
        }
    });

    function updateFileUI(file) {
        const fileSizeKB = Math.round(file.size / 1024);
        console.log(`[UI] File selected: ${file.name} (${fileSizeKB} KB)`);
        if (statusDiv) {
            statusDiv.textContent = `Selected: ${file.name} (${fileSizeKB} KB)`;
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
                statusDiv.textContent = 'Processing and compressing file... Please wait.';
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
                }
            } catch (err) {
                console.error(err);
                if (statusDiv) {
                    statusDiv.textContent = `Error: ${err.message}`;
                }
                alert(err.message);
            }
        });
    }
});
