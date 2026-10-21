import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins:[{name:'offline-assets',generateBundle(_,bundle){this.emitFile({type:'asset',fileName:'offline-assets.json',source:JSON.stringify(Object.keys(bundle))});}}]
});
