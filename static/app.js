// Simple Frontend Router & Logic

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    
    if (path === '/' || path === '/index.html') {
        initLogin();
    } else if (path === '/dashboard' || path === '/dashboard.html') {
        initDashboard();
    }
});

// --- Login Logic ---
function initLogin() {
    const phoneForm = document.getElementById('phone-form');
    const codeForm = document.getElementById('code-form');
    const stepPhone = document.getElementById('step-phone');
    const stepCode = document.getElementById('step-code');
    const btnBack = document.getElementById('btn-back');
    const phoneInput = document.getElementById('phone');
    
    if (!phoneForm) return;

    phoneForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = phoneInput.value;
        const errorDiv = document.getElementById('phone-error');
        errorDiv.classList.add('hidden');
        
        try {
            const res = await fetch('/api/auth/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            
            if (res.ok) {
                stepPhone.classList.add('hidden');
                stepCode.classList.remove('hidden');
            } else {
                errorDiv.textContent = data.error || 'Failed to send code';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    codeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = phoneInput.value;
        const code = document.getElementById('code').value;
        const errorDiv = document.getElementById('code-error');
        errorDiv.classList.add('hidden');
        
        try {
            const res = await fetch('/api/auth/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, code })
            });
            const data = await res.json();
            
            if (res.ok) {
                window.location.href = '/dashboard';
            } else {
                errorDiv.textContent = data.error || 'Invalid code';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    btnBack.addEventListener('click', () => {
        stepCode.classList.add('hidden');
        stepPhone.classList.remove('hidden');
    });
}

// --- Dashboard Logic ---
function initDashboard() {
    const walletsContainer = document.getElementById('wallets-container');
    const modal = document.getElementById('connect-modal');
    const btnOpenModal = document.getElementById('btn-open-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const walletForm = document.getElementById('wallet-form');
    const btnLogout = document.getElementById('btn-logout');

    if (!walletsContainer) return;

    // Fetch and display wallets
    async function loadWallets() {
        try {
            const res = await fetch('/api/wallets');
            if (res.status === 401) {
                window.location.href = '/';
                return;
            }
            const data = await res.json();
            renderWallets(data.wallets || []);
        } catch (err) {
            console.error('Failed to load wallets');
        }
    }

    function renderWallets(wallets) {
        if (wallets.length === 0) {
            walletsContainer.innerHTML = `
                <div class="glass-panel" style="grid-column: 1 / -1; padding: 3rem; text-align: center;">
                    <p style="margin-bottom: 1rem;">No wallets connected yet.</p>
                    <button onclick="document.getElementById('btn-open-modal').click()" style="width: auto;">Connect Your First Wallet</button>
                </div>
            `;
            return;
        }

        walletsContainer.innerHTML = wallets.map(w => `
            <div class="glass-panel wallet-card" data-id="${w.id}" data-name="${w.name}" style="position: relative;">
                <button class="btn-delete-wallet" data-id="${w.id}" style="position: absolute; top: 1rem; right: 1rem; background: transparent; color: var(--error-color); padding: 0.25rem; width: auto; border: 1px solid var(--error-color); border-radius: 4px; display: flex; align-items: center; justify-content: center;" title="Delete Wallet">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>
                </button>
                <div class="wallet-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/>
                        <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/>
                        <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/>
                    </svg>
                </div>
                <h3>${w.name}</h3>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 1rem;">
                    <span style="font-size: 0.875rem; color: var(--text-muted);">Tradernet API</span>
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
                </div>
                <div class="wallet-api-key">${w.api_key.substring(0, 8)}••••••••••••</div>
                <div style="margin-top: 1rem; text-align: center; font-size: 0.75rem; color: var(--accent-color);">Click to Open API Explorer</div>
            </div>
        `).join('');
    }

    // Modal Events
    btnOpenModal.addEventListener('click', () => {
        modal.classList.add('active');
    });

    btnCloseModal.addEventListener('click', () => {
        modal.classList.remove('active');
        walletForm.reset();
        document.getElementById('wallet-error').classList.add('hidden');
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            btnCloseModal.click();
        }
    });

    // --- API Explorer Logic ---
    const explorerModal = document.getElementById('explorer-modal');
    const btnCloseExplorer = document.getElementById('btn-close-explorer');
    const explorerForm = document.getElementById('explorer-form');
    const explorerWalletId = document.getElementById('explorer-wallet-id');
    const explorerTitle = document.getElementById('explorer-title');
    const apiResponse = document.getElementById('api-response');

    // Make wallet cards clickable to open explorer
    walletsContainer.addEventListener('click', async (e) => {
        const deleteBtn = e.target.closest('.btn-delete-wallet');
        if (deleteBtn) {
            e.stopPropagation();
            if (confirm('Are you sure you want to delete this wallet?')) {
                const walletId = deleteBtn.dataset.id;
                try {
                    const res = await fetch('/api/wallets', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: walletId })
                    });
                    if (res.ok) {
                        loadWallets();
                    } else {
                        alert('Failed to delete wallet');
                    }
                } catch (err) {
                    alert('Network error');
                }
            }
            return;
        }

        const card = e.target.closest('.wallet-card');
        if (card) {
            const walletId = card.dataset.id;
            const walletName = card.dataset.name;
            explorerTitle.textContent = `API Explorer: ${walletName}`;
            explorerWalletId.value = walletId;
            apiResponse.textContent = "Awaiting request...";
            explorerModal.classList.add('active');
        }
    });

    btnCloseExplorer.addEventListener('click', () => {
        explorerModal.classList.remove('active');
        explorerForm.reset();
        document.getElementById('explorer-error').classList.add('hidden');
    });

    explorerModal.addEventListener('click', (e) => {
        if (e.target === explorerModal) {
            btnCloseExplorer.click();
        }
    });

    explorerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const walletId = explorerWalletId.value;
        const cmd = document.getElementById('api-cmd').value;
        const paramsStr = document.getElementById('api-params').value;
        const errorDiv = document.getElementById('explorer-error');
        errorDiv.classList.add('hidden');

        let params = {};
        if (paramsStr.trim() !== '') {
            try {
                params = JSON.parse(paramsStr);
            } catch (err) {
                errorDiv.textContent = 'Invalid JSON in parameters';
                errorDiv.classList.remove('hidden');
                return;
            }
        }

        apiResponse.textContent = "Loading...";

        try {
            const res = await fetch('/api/tradernet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletId, cmd, params })
            });
            const data = await res.json();
            apiResponse.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
            apiResponse.textContent = "Network error or server unavailable.";
        }
    });

    // Add Wallet
    walletForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wallet-name').value;
        const apiKey = document.getElementById('api-key').value;
        const secretKey = document.getElementById('secret-key').value;
        const errorDiv = document.getElementById('wallet-error');
        errorDiv.classList.add('hidden');

        try {
            const res = await fetch('/api/wallets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, apiKey, secretKey })
            });
            const data = await res.json();

            if (res.ok) {
                btnCloseModal.click();
                loadWallets();
            } else {
                errorDiv.textContent = data.error || 'Failed to connect wallet';
                errorDiv.classList.remove('hidden');
            }
        } catch (err) {
            errorDiv.textContent = 'Network error';
            errorDiv.classList.remove('hidden');
        }
    });

    // Logout
    btnLogout.addEventListener('click', () => {
        document.cookie = "session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.href = '/';
    });

    // Init
    loadWallets();
}
