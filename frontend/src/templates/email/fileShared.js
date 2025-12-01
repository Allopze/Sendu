/**
 * File Shared Email Template
 * Sent when a user shares a file with someone
 */

import { baseStyles } from './baseStyles';

// Custom footer for file shared (includes expiration)
export const fileSharedTemplate = {
    name: 'Archivo Compartido',
    subject: '{{username}} te ha compartido un archivo',
    html: `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>${baseStyles}</style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="{{logoUrl}}" alt="{{appName}}" />
        </div>
        <div class="content">
            <h2>¡Hola!</h2>
            <p><strong>{{username}}</strong> te ha compartido un archivo:</p>
            <p><strong>Archivo:</strong> {{fileName}}<br>
            <strong>Tamaño:</strong> {{fileSize}}<br>
            <strong>Expira:</strong> {{expirationDate}}</p>
            <p style="text-align: center;">
                <a href="{{downloadLink}}" class="button">Descargar Archivo</a>
            </p>
        </div>
        <div class="footer">
            <p>Este enlace expirará el {{expirationDate}}</p>
            <p>{{appName}} - {{appUrl}}</p>
        </div>
    </div>
</body>
</html>`
};

export default fileSharedTemplate;
