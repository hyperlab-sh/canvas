// The "service not running" page: polls the service through the app, offers to start it, and hands over
// to the editor as soon as it answers.
const { invoke } = window.__TAURI__.core;

const status = document.getElementById('status');
const detail = document.getElementById('detail');
const start = document.getElementById('start');
const POLL_MS = 1500;
const START_GIVE_UP_MS = 20000;

let starting = false;
let startedAt = 0;
let leaving = false;

const say = (text) => { status.textContent = text; };
const explain = (text) => { detail.textContent = text; detail.hidden = !text; };

async function check() {
  if (leaving) return;
  let state;
  try {
    state = await invoke('probe');
  } catch (error) {
    say('Could not check the service.');
    explain(String(error));
    return;
  }
  if (state.up) {
    leaving = true;
    say('Service found. Opening the editor…');
    try {
      await invoke('open_service');
    } catch (error) {
      leaving = false;
      explain(String(error));
    }
    return;
  }
  if (starting && Date.now() - startedAt < START_GIVE_UP_MS) {
    say('Starting the service…');
    return;
  }
  if (starting) {
    starting = false;
    start.disabled = false;
    say('The service did not come up.');
    explain('Run `canvas serve` in a terminal to see why. This page keeps looking.');
    return;
  }
  say(`The Canvas service is not running on port ${state.port}.`);
  start.hidden = !state.canStart;
  explain(state.canStart ? 'Start it here, or run `canvas serve` in a terminal. This page keeps looking.'
    : 'The `canvas` command was not found on your PATH. Install Canvas, then run `canvas serve`. This page keeps looking.');
}

start.addEventListener('click', async () => {
  starting = true;
  startedAt = Date.now();
  start.disabled = true;
  say('Starting the service…');
  explain('');
  try {
    await invoke('start_service');
  } catch (error) {
    starting = false;
    start.disabled = false;
    explain(String(error));
  }
});

check();
setInterval(check, POLL_MS);
