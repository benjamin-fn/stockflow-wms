import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwind()],build:{rolldownOptions:{output:{codeSplitting:{groups:[{name:'charts',test:/node_modules[\\\\/](recharts|d3-[^\\\\/]+)[\\\\/]/}]}}}},server:{host:'127.0.0.1',port:5174,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:5081'},'/openapi':{target:'http://127.0.0.1:5081'}}}});