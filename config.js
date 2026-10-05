// Configurarea aplicației JM. Adresa scriptului nu e secretă: fără cheia secretă
// (introdusă o singură dată pe telefon) scriptul nu acceptă nimic.
window.JM_CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyoh4msLb4oE2hJNS8NHv8ii3cPg992teRy0pwApc-YSvoyeREzj3rbFV4Urs4ose0l/exec',   // adresa „poștașului” Apps Script (Deploy → Web app URL)
  // Folderele din G:\My Drive\04_Makemefit\Aplicatie_jurnal_wellness
  FOLDERS: ['00_Config', '01_Text_original', '02_Date_zilnice', '03_Foto', '05_Notificari'],
  TEXT_FOLDER: '01_Text_original',
  VERSION: '1.2.0'
};
