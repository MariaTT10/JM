// Configurarea aplicației JM. Aceste valori sunt publice prin natura lor:
// sunt restricționate în Google Cloud la adresa https://mariatt10.github.io.
window.JM_CONFIG = {
  CLIENT_ID: '81281017291-ugleq0n5lmghr6eki06ef39ca6ivqn7t.apps.googleusercontent.com',
  API_KEY: 'AIzaSyAnazapg3iRbdkcKUAFBgltKTqU7rk2qTA',   // doar Google Picker API
  APP_ID: '81281017291',                                 // project number
  REDIRECT_URI: 'https://mariatt10.github.io/JM/',
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
  // Folderele din G:\My Drive\04_Makemefit\Aplicatie_jurnal_wellness
  FOLDERS: ['00_Config', '01_Text_original', '02_Date_zilnice', '03_Foto', '05_Notificari'],
  TEXT_FOLDER: '01_Text_original',
  VERSION: '1.0.1'
};
