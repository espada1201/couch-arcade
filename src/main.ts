import '@fontsource-variable/archivo/wdth.css';
import './style.css';
import { landing } from './landing';
import { errorText } from './ui/dom';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;

async function boot(): Promise<void> {
  const room = params.get('room');
  if (room) {
    const { phoneView } = await import('./phone/view');
    await phoneView(app, room.toUpperCase(), params);
  } else if (params.has('host')) {
    const { hostView } = await import('./host/view');
    await hostView(app, params);
  } else landing(app, params);
}

boot().catch((e: unknown) => {
  app.replaceChildren();
  const p = document.createElement('p');
  p.className = 'fatal';
  p.textContent = `Something went wrong starting Swarm Screen: ${errorText(e)}`;
  app.append(p);
});
