import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Providers } from '@/providers';
import { RootRouter } from '@/RootRouter';
import '@/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found');
}

// RootRouter picks the mobile vs desktop router by viewport (inside Providers → LangProvider).
createRoot(rootEl).render(
  <StrictMode>
    <Providers>
      <RootRouter />
    </Providers>
  </StrictMode>,
);
