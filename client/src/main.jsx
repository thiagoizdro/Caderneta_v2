import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { ensureDefaults, migrateLegacyStorage } from './lib/bootstrap.js';
import { DataProvider } from './state.jsx';
import './styles/tokens.css';
import './styles/app.css';

// Migração da v1 e registros padrão rodam antes do primeiro render,
// para quem já usava o Caderneta não ver a tela de boas-vindas.
async function boot() {
    let migrated = null;
    let bootError = null;
    try {
        migrated = await migrateLegacyStorage();
        await ensureDefaults();
    } catch (error) {
        console.error(error);
        bootError = error;
    }
    createRoot(document.getElementById('root')).render(
        <StrictMode>
            <DataProvider>
                <App migrated={migrated} bootError={bootError} />
            </DataProvider>
        </StrictMode>,
    );
}

boot();
