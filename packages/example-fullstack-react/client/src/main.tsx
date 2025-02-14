import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app.tsx'
import { ChatSyncProvider } from './chat-sync-provider.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatSyncProvider>
      <App />
    </ChatSyncProvider>
  </StrictMode>,
)
