import { closeWindow, maximizeWindow, minimizeWindow } from './handlers';
import { os } from '@orpc/server';

export const window = os.router({
  minimizeWindow,
  maximizeWindow,
  closeWindow,
});
