/**
 * Password Reset Email Template
 * Sent when a user requests password reset
 */

import { wrapInBaseTemplate } from './baseStyles';

const content = `
    <h2>Restablecer Contraseña</h2>
    <p>Hola {{username}},</p>
    <p>Hemos recibido una solicitud para restablecer tu contraseña. Haz clic en el siguiente botón para crear una nueva:</p>
    <p style="text-align: center;">
        <a href="{{resetLink}}" class="button">Restablecer Contraseña</a>
    </p>
    <p>Este enlace expirará en 1 hora. Si no solicitaste este cambio, ignora este mensaje.</p>
`;

export const passwordResetTemplate = {
    name: 'Reseteo de Contraseña',
    subject: 'Restablecer contraseña - {{appName}}',
    html: wrapInBaseTemplate(content)
};

export default passwordResetTemplate;
