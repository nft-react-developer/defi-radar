import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm'; 
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const connectionConfig = {
  host: process.env.DB_HOST || '192.168.1.133',
  user: process.env.DB_USER || 'dev',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'yieldradar',
  port: Number(process.env.DB_PORT) || 3306,
};

async function testDrizzle() {
  let connection;
  
  try {
    console.log('🔌 Conectando a MariaDB via Drizzle...');
    console.log(`Host: ${connectionConfig.host}:${connectionConfig.port}`);

    // Crear conexión
    connection = await mysql.createConnection(connectionConfig);
    const db = drizzle(connection);
    
    // Test 1: Query raw usando sql de drizzle-orm (forma correcta)
    const result = await db.execute(
      sql`SELECT VERSION() as version, NOW() as server_time`
    );
    
    console.log('✅ ¡CONECTADO!');
    console.log('Versión MariaDB:', result[0][0].version);
    console.log('Hora servidor:', result[0][0].server_time);
    
    // Test 2: Otra forma - usar el driver nativo directamente
    const [rows]: any = await connection.execute('SELECT 1+1 as test');
    console.log('✅ Test nativo mysql2:', rows[0].test === 2 ? 'OK' : 'FAIL');
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Verificá que MariaDB esté corriendo y el puerto 3306 abierto');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('💡 Usuario/password incorrecto');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.log('💡 Creá la DB: CREATE DATABASE yieldradar;');
    }
    
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

testDrizzle();