// Declared content scripts are classic scripts in MV3. Load the application as
// an extension-origin module so the implementation can keep normal ESM imports.
void import(chrome.runtime.getURL('content-module.js')).catch(error => {
  console.error('prreview 無法載入側邊欄：', error)
})
