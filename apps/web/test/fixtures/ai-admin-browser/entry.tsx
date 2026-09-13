// Test-only browser mount. The real configuration components and their real
// fetch calls are unchanged. This is not a Next/Google authentication fixture.
import { createRoot } from 'react-dom/client';
import { AdminAiConsole } from '../../../components/admin-ai-console';
import { AdminAiProfiles } from '../../../components/admin-ai-profiles';
import type {
  AiConnection,
  AiProfile,
  AiProbe,
} from '../../../../../packages/database/src/ai-config-store.mjs';

interface InitialData {
  connections: AiConnection[];
  profiles: AiProfile[];
  probes: AiProbe[];
}

async function mount() {
  const response = await fetch('/__fixture/bootstrap', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Fixture bootstrap failed');
  const data = (await response.json()) as InitialData;
  const container = document.getElementById('fixture-root');
  if (!container) throw new Error('Fixture root missing');
  createRoot(container).render(
    window.location.pathname === '/admin/ai/profiles' ? (
      <AdminAiProfiles
        connections={data.connections}
        initialProfiles={data.profiles}
        configured
        available
      />
    ) : (
      <AdminAiConsole
        initialConnections={data.connections}
        initialProbes={data.probes}
        configured
        available
        allowedHosts={['example.com']}
      />
    ),
  );
}
void mount().catch(() => {
  const container = document.getElementById('fixture-root');
  if (container) container.textContent = 'Fixture initialization failed';
});
