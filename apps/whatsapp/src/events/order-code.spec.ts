import { describe, expect, it } from 'vitest';
import { extractOrderCode } from './order-code.js';

describe('extractOrderCode', () => {
  it.each([
    ['Olá! Quero acompanhar minha OS pelo WhatsApp. Código: OS-K7Q2-X9MA', 'OS-K7Q2-X9MA'],
    ['os-k7q2-x9ma', 'OS-K7Q2-X9MA'], // minúsculas
    ['OS K7Q2 X9MA', 'OS-K7Q2-X9MA'], // espaços no lugar de hífen
    ['OSK7Q2X9MA', 'OS-K7Q2-X9MA'], // sem separador
    ['código: OS-K7Q2-X9MA, obrigado', 'OS-K7Q2-X9MA'], // pontuação em volta
    ['OS-K7QZ-X9MA', 'OS-K7QZ-X9MA'],
  ])('%s -> %s', (text, code) => expect(extractOrderCode(text)).toBe(code));

  it('corrige as confusões clássicas O/0 e I/L/1', () => {
    expect(extractOrderCode('OS-KO7I-LB2A')).toBe('OS-K071-1B2A');
  });

  it.each([
    'bom dia, quero saber da minha OS',
    'os dois carros', // "OS" + palavras comuns: U fora do alfabeto
    'OS-K7Q2', // incompleto
    'OS-K7Q2-X9MAB', // longo demais: não é o código
    'XOS-K7Q2-X9MA', // colado em outra palavra
    '',
  ])('ignora "%s"', (text) => expect(extractOrderCode(text)).toBeNull());

  it('aceita ausência de texto (mensagem de mídia)', () => {
    expect(extractOrderCode(null)).toBeNull();
    expect(extractOrderCode(undefined)).toBeNull();
  });

  it('só varre o começo de textos longos', () => {
    expect(extractOrderCode(`${'a'.repeat(600)} OS-K7Q2-X9MA`)).toBeNull();
  });
});
