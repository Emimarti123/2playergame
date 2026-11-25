'use strict';

// Constantes del juego. Velocidades en px/s y aceleraciones en px/s² (todo se mueve con dt).
// Se leen del entorno en cada llamada para poder sobreescribirlas en pruebas.
function getConfig() {
  const num = (name, def) => {
    const raw = process.env[name];
    const v = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(v) ? v : def;
  };
  return {
    PORT: num('PORT', 3000),

    // Arena (canvas lógico, igual que los ejemplos: 800x450)
    WIDTH: 800,
    HEIGHT: 450,
    GROUND_Y: 400, // y donde pisan los pies en el suelo
    // Plataformas de un solo sentido: se aterriza encima al caer, se atraviesan desde abajo.
    PLATFORMS: [
      { x: 90, y: 300, w: 170 },
      { x: 540, y: 300, w: 170 },
      { x: 315, y: 215, w: 170 },
      { x: 150, y: 140, w: 110 },
      { x: 540, y: 140, w: 110 },
    ],
    SPAWN: { left: 150, right: 650 },

    // Ninja (física tomada del ejemplo de sprite: aceleración, gravedad, salto corto al soltar)
    RUN_SPEED: 280,
    ACCEL_GROUND: 2600,
    ACCEL_AIR: 1600,
    GRAVITY: 2000,
    JUMP_VELOCITY: -760,
    JUMP_CUT: -280, // soltar el salto antes de la cima = salto corto
    HIT_W: 28, // hitbox (más chica que el dibujo)
    HIT_H: 58,
    MAX_HP: 5,
    INVULN_S: 0.9, // invulnerable tras recibir daño
    HURT_S: 0.35, // sin control tras recibir daño
    KNOCKBACK_X: 330,
    KNOCKBACK_Y: -420,
    STOMP_BOUNCE: -620, // rebote al caer sobre la cabeza del rival
    DROP_S: 0.25, // tiempo atravesando plataformas al pulsar abajo

    // Shuriken
    STAR_SPEED: 620,
    STAR_R: 9,
    STAR_COOLDOWN_S: 0.42,
    STAR_MAX_PER_PLAYER: 3,
    THROW_ANIM_S: 0.25,
    STAR_MAX_SPEED: 1100,

    // Espada: preparación visible (se puede reaccionar aunque haya lag), golpe y recuperación
    SLASH_STARTUP_S: 0.15,
    SLASH_ACTIVE_S: 0.1,
    SLASH_RECOVERY_S: 0.25,
    SLASH_RANGE: 64, // alcance al frente desde el centro del personaje
    SLASH_KNOCKBACK_X: 520, // empuja más que el shuriken
    SLASH_KNOCKBACK_Y: -480,
    SWORD_CLASH_PUSH: 320, // espada contra espada: ambos retroceden

    // Parry: ventana generosa; si no paras nada quedas vulnerable un momento
    PARRY_WINDOW_S: 0.2,
    PARRY_FAIL_S: 0.4,
    PARRY_REACH: 16, // margen extra frente al personaje para atrapar shurikens
    PARRY_INVULN_S: 0.25,
    STUN_S: 1.2, // atacante aturdido tras un parry
    STUN_PUSH: 60, // poco: quien hizo parry alcanza a contraatacar
    REFLECT_SPEEDUP: 1.3, // el shuriken devuelto sale más rápido

    WIN_SCORE: num('WIN_SCORE', 3), // rondas para ganar

    TICK_RATE: 60,
    STATE_RATE: 60, // estado a cada tick: menos retraso para el rival

    COUNTDOWN_MS: 3000,
    POINT_PAUSE_MS: 2600, // KO visible → se reacomoda → "¡Pelea!"
    ROUND_RESET_AT_MS: 1400, // momento de la pausa en que se reinician posiciones y vida
    RECONNECT_GRACE_MS: num('RECONNECT_GRACE_MS', 10000),
    IDLE_KICK_MS: 60000, // sin pulsar "Listo" en READY
    INPUT_MAX_PER_SEC: 120,

    ALLOW_SAME_BROWSER: process.env.ALLOW_SAME_BROWSER === '1',
    // Render define RENDER=true en sus servicios; HIDE_TOOLS=1 fuerza lo mismo en otro sitio
    HIDE_TOOLS: process.env.RENDER === 'true' || process.env.HIDE_TOOLS === '1',
  };
}

module.exports = { getConfig };
