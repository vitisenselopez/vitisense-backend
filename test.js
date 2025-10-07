// backend/test.js
import fetch from 'node-fetch';

const runTest = async () => {
  try {
    const response = await fetch('http://localhost:3010/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: "¿Qué es la fotosíntesis?" })
    });

    const data = await response.json();
    console.log("Respuesta del backend:", data);
  } catch (error) {
    console.error("Error en la prueba:", error);
  }
};

runTest();