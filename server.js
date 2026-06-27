// ==================== IMPORTACIONES ====================
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

// ==================== CONFIGURACIÓN ====================
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos desde la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==================== BASE DE DATOS ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : false,
});

// ==================== FUNCIÓN DE AUDITORÍA ====================

const registrarAuditoria = async (usuarioId, usuarioCorreo, usuarioRol, accion, entidad, entidadId, detalles, ip) => {
    try {
        const query = `
            INSERT INTO auditoria (usuario_id, usuario_correo, usuario_rol, accion, entidad, entidad_id, detalles, ip, fecha)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        `;
        await pool.query(query, [usuarioId, usuarioCorreo, usuarioRol, accion, entidad, entidadId, detalles, ip]);
        console.log(`✅ Auditoría registrada: ${accion} - ${entidad} ID: ${entidadId}`);
    } catch (err) {
        console.error('❌ Error al registrar auditoría:', err.message);
    }
};

const getRequestIp = (req) => {
    return req.ip
        || req.connection?.remoteAddress
        || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
        || 'desconocido';
};

// ==================== CONFIGURACIÓN DE MULTER (para PDFs) ====================
const uploadDir = path.join(__dirname, 'uploads', 'documentos-tea');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Carpeta creada:', uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `tea-${req.params.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos PDF'));
        }
    }
});

// ==================== RUTAS DE PACIENTES ====================

// RUTA PARA GUARDAR PACIENTE (POST)
app.post('/pacientes', async (req, res) => {
  const { 
    nombre_apellido,
    codigo_funauta,
    cedula_rif,
    genero, 
    fecha_nacimiento,
    fecha_ingreso,
    nacionalidad, 
    carnet_discapacidad,
    diagnostico_tea,
    id_padre, 
    activo 
  } = req.body;

  try {
    const fechaNac = fecha_nacimiento || null;
    const fechaIng = fecha_ingreso || null;
    
    if (!nombre_apellido) {
      return res.status(400).json({ 
        success: false, 
        mensaje: 'El nombre del paciente es requerido' 
      });
    }
    
    const codigoExistente = await pool.query(
      'SELECT id_paciente FROM pacientes WHERE codigo_funauta = $1',
      [codigo_funauta]
    );
    
    if (codigoExistente.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        mensaje: `El código "${codigo_funauta}" ya está registrado` 
      });
    }
    
    const query = `INSERT INTO pacientes (
      nombre_apellido, 
      codigo_funauta, 
      cedula_rif, 
      genero, 
      fecha_nacimiento, 
      fecha_ingreso, 
      nacionalidad, 
      carnet_discapacidad, 
      diagnostico_tea, 
      id_padre, 
      activo
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`;
    
    const values = [
      nombre_apellido, 
      codigo_funauta, 
      cedula_rif, 
      genero,
      fechaNac, 
      fechaIng,
      nacionalidad, 
      carnet_discapacidad === true || carnet_discapacidad === 'true', 
      diagnostico_tea === true || diagnostico_tea === 'true',
      id_padre || null,
      activo !== undefined ? activo : true
    ];

    const result = await pool.query(query, values);
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Paciente guardado correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al insertar:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// RUTA PARA EDITAR PACIENTE (PUT)
app.put('/pacientes/:id', async (req, res) => {
  const { id } = req.params;
  const { 
    nombre_apellido,
    codigo_funauta,
    cedula_rif,
    genero, 
    fecha_nacimiento,
    fecha_ingreso,
    nacionalidad, 
    carnet_discapacidad,
    diagnostico_tea,
    id_padre, 
    activo 
  } = req.body;

  try {
    if (activo !== undefined && Object.keys(req.body).length === 1) {
      const query = `UPDATE pacientes SET activo = $1 WHERE id_paciente = $2 RETURNING *`;
      const result = await pool.query(query, [activo, id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
      }
      
      const mensaje = activo ? 'Paciente activado correctamente' : 'Paciente inactivado correctamente';
      return res.status(200).json({ success: true, data: result.rows[0], mensaje });
    }
    
    if (codigo_funauta) {
      const codigoExistente = await pool.query(
        'SELECT id_paciente FROM pacientes WHERE codigo_funauta = $1 AND id_paciente != $2',
        [codigo_funauta, id]
      );
      
      if (codigoExistente.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          mensaje: `El código "${codigo_funauta}" ya está registrado por otro paciente` 
        });
      }
    }
    
    const fechaNac = fecha_nacimiento || null;
    const fechaIng = fecha_ingreso || null;
    
    const query = `UPDATE pacientes SET 
      nombre_apellido = $1, 
      codigo_funauta = $2, 
      cedula_rif = $3, 
      genero = $4,
      fecha_nacimiento = $5, 
      fecha_ingreso = $6,
      nacionalidad = $7, 
      carnet_discapacidad = $8, 
      diagnostico_tea = $9,
      id_padre = $10,
      activo = $11
      WHERE id_paciente = $12
      RETURNING *`;
    
    const values = [
      nombre_apellido, 
      codigo_funauta, 
      cedula_rif, 
      genero,
      fechaNac, 
      fechaIng,
      nacionalidad, 
      carnet_discapacidad === true || carnet_discapacidad === 'true', 
      diagnostico_tea === true || diagnostico_tea === 'true',
      id_padre || null,
      activo !== undefined ? activo : true,
      id
    ];

    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
    }
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Paciente actualizado correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al actualizar:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// RUTA PARA SUBIR DOCUMENTO TEA (POST)
app.post('/pacientes/:id/upload-documento-tea', upload.single('documento_tea'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const pacienteExistente = await pool.query(
      'SELECT id_paciente FROM pacientes WHERE id_paciente = $1',
      [id]
    );
    
    if (pacienteExistente.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });
    }
    
    const fileUrl = `/uploads/documentos-tea/${req.file.filename}`;
    const fileName = req.file.originalname;
    const fileDate = new Date().toISOString();
    
    const query = `
      UPDATE pacientes 
      SET documento_tea_url = $1, 
          documento_tea_nombre = $2, 
          documento_tea_fecha = $3 
      WHERE id_paciente = $4
    `;
    
    await pool.query(query, [fileUrl, fileName, fileDate, id]);
    
    res.json({ 
      success: true, 
      fileUrl: fileUrl,
      fileName: fileName,
      mensaje: 'Documento TEA subido correctamente'
    });
  } catch (error) {
    console.error('❌ Error al subir documento:', error);
    res.status(500).json({ success: false, mensaje: 'Error al subir el documento' });
  }
});

// RUTA PARA ELIMINAR DOCUMENTO TEA (DELETE)
app.delete('/pacientes/:id/documento-tea', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT documento_tea_url FROM pacientes WHERE id_paciente = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
    }
    
    const documentoUrl = result.rows[0].documento_tea_url;
    
    if (documentoUrl) {
      const filePath = path.join(__dirname, documentoUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    await pool.query(
      `UPDATE pacientes 
       SET documento_tea_url = NULL, 
           documento_tea_nombre = NULL, 
           documento_tea_fecha = NULL 
       WHERE id_paciente = $1`,
      [id]
    );
    
    res.json({ 
      success: true, 
      mensaje: 'Documento TEA eliminado correctamente'
    });
  } catch (error) {
    console.error('❌ Error al eliminar documento:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar el documento' });
  }
});

// RUTA PARA OBTENER PACIENTES (GET)
app.get('/pacientes', async (req, res) => {
  const { rol, id_especialista, padre_id, solo_activos } = req.query;
  
  try {
    let query = `SELECT 
      p.id_paciente,
      p.nombre_apellido,
      p.codigo_funauta,
      p.cedula_rif,
      p.genero,
      TO_CHAR(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      TO_CHAR(p.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
      p.nacionalidad,
      p.carnet_discapacidad,
      p.diagnostico_tea,
      p.activo,
      p.id_padre,
      p.documento_tea_url,
      p.documento_tea_nombre,
      p.documento_tea_fecha,
      pa.nombre_padre
    FROM pacientes p
    LEFT JOIN padres pa ON p.id_padre = pa.id_padre`;
    
    let values = [];
    let conditions = [];
    
    if (padre_id) {
      conditions.push(`p.id_padre = $${values.length + 1}`);
      values.push(padre_id);
    }
    
    if (rol === 'especialista' && id_especialista) {
      conditions.push(`p.id_paciente IN (SELECT id_paciente FROM pacientes_especialistas WHERE id_especialista = $${values.length + 1})`);
      values.push(id_especialista);
    }
    
    if (solo_activos === 'true') {
      conditions.push(`p.activo = true`);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY p.nombre_apellido ASC`;
    
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error("❌ Error al obtener pacientes:", err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// RUTA PARA OBTENER UN PACIENTE POR ID (GET)
app.get('/pacientes/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `SELECT 
      p.id_paciente,
      p.nombre_apellido,
      p.codigo_funauta,
      p.cedula_rif,
      p.genero,
      TO_CHAR(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      TO_CHAR(p.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
      p.nacionalidad,
      p.carnet_discapacidad,
      p.diagnostico_tea,
      p.activo,
      p.id_padre,
      p.documento_tea_url,
      p.documento_tea_nombre,
      p.documento_tea_fecha,
      pa.nombre_padre
    FROM pacientes p
    LEFT JOIN padres pa ON p.id_padre = pa.id_padre
    WHERE p.id_paciente = $1`;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
    }
    
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("❌ Error al obtener paciente:", err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// RUTA PARA OBTENER ESTADÍSTICAS DE PACIENTES (GET)
app.get('/pacientes/estadisticas/resumen', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) as total FROM pacientes');
    const activos = await pool.query('SELECT COUNT(*) as activos FROM pacientes WHERE activo = true');
    const inactivos = await pool.query('SELECT COUNT(*) as inactivos FROM pacientes WHERE activo = false');
    const conTEA = await pool.query('SELECT COUNT(*) as con_tea FROM pacientes WHERE diagnostico_tea = true');
    
    res.json({
      success: true,
      data: {
        total: parseInt(total.rows[0].total),
        activos: parseInt(activos.rows[0].activos),
        inactivos: parseInt(inactivos.rows[0].inactivos),
        conTEA: parseInt(conTEA.rows[0].con_tea)
      }
    });
  } catch (err) {
    console.error("❌ Error al obtener estadísticas:", err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA ESPECIALISTAS ====================

// OBTENER ESPECIALISTAS (GET)
app.get('/especialistas', async (req, res) => {
  const { rol, id_especialista, correo, solo_activos } = req.query;
  
  try {
    let query = `
      SELECT 
        e.id_especialista,
        e.nombre_especialista,
        e.especialidad,
        e.cargo,
        e.telefono,
        e.correo,
        e.activo,
        e.id_usuario,
        u.activo as usuario_activo
      FROM especialistas e
      LEFT JOIN usuarios u ON e.id_usuario = u.id_usuario
      WHERE 1=1
    `;
    
    let values = [];
    let idx = 1;
    
    if (rol === 'admin') {
      if (solo_activos === 'true') {
        query += ` AND e.activo = true`;
      }
    } else if (rol === 'especialista' && id_especialista) {
      query += ` AND e.id_especialista = $${idx++}`;
      values.push(id_especialista);
    } else if (correo) {
      query += ` AND e.correo = $${idx++}`;
      values.push(correo);
    } else {
      return res.status(403).json({ success: false, mensaje: "No autorizado" });
    }
    
    query += ` ORDER BY e.nombre_especialista ASC`;
    
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener especialistas:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER UN ESPECIALISTA POR ID (GET)
app.get('/especialistas/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        e.id_especialista,
        e.nombre_especialista,
        e.especialidad,
        e.cargo,
        e.telefono,
        e.correo,
        e.activo,
        e.id_usuario
      FROM especialistas e
      WHERE e.id_especialista = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0] 
    });
  } catch (err) {
    console.error('❌ Error al obtener especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// REGISTRAR NUEVO ESPECIALISTA (POST)
app.post('/especialistas', async (req, res) => {
  const { 
    nombre_especialista, 
    especialidad, 
    cargo, 
    telefono, 
    correo, 
    password,
    activo 
  } = req.body;
  
  const errores = [];
  if (!nombre_especialista || nombre_especialista.trim() === '') {
    errores.push('El nombre del especialista es requerido');
  }
  if (!correo || correo.trim() === '') {
    errores.push('El correo electrónico es requerido');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    errores.push('El formato del correo electrónico no es válido');
  }
  if (!password || password.trim() === '') {
    errores.push('La contraseña es requerida');
  } else if (password.length < 3) {
    errores.push('La contraseña debe tener al menos 3 caracteres');
  }
  
  if (errores.length > 0) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'Por favor corrija los siguientes errores:',
      errores: errores
    });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const existingUser = await client.query(
      'SELECT id_usuario FROM usuarios WHERE correo = $1',
      [correo.trim().toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        mensaje: `El correo "${correo}" ya está registrado. Use otro correo.` 
      });
    }
    
    const rolResult = await client.query(
      "SELECT id_rol FROM roles WHERE nombre = 'especialista'"
    );
    
    let idRol = 2;
    if (rolResult.rows.length > 0) {
      idRol = rolResult.rows[0].id_rol;
    }
    
    const userResult = await client.query(
      `INSERT INTO usuarios (correo, password, id_rol, activo) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id_usuario`,
      [correo.trim().toLowerCase(), password, idRol, activo !== undefined ? activo : true]
    );
    
    const idUsuario = userResult.rows[0].id_usuario;
    console.log('✅ Usuario creado con ID:', idUsuario);
    
    const especialistaResult = await client.query(
      `INSERT INTO especialistas (
        nombre_especialista, 
        especialidad, 
        cargo, 
        telefono, 
        correo, 
        id_usuario,
        activo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *`,
      [
        nombre_especialista.trim(), 
        especialidad || null, 
        cargo || null, 
        telefono || null, 
        correo.trim().toLowerCase(), 
        idUsuario,
        true
      ]
    );
    
    console.log('✅ Especialista creado con ID:', especialistaResult.rows[0].id_especialista);
    
    await client.query('COMMIT');
    await registrarAuditoria(
      null,
      correo.trim().toLowerCase(),
      'sistema',
      'crear',
      'especialista',
      especialistaResult.rows[0].id_especialista,
      `Especialista registrado: ${especialistaResult.rows[0].nombre_especialista}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ 
      success: true, 
      data: especialistaResult.rows[0], 
      mensaje: 'Especialista registrado exitosamente. Ya puede iniciar sesión.' 
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al registrar especialista:', err.message);
    res.status(500).json({ 
      success: false, 
      mensaje: 'Error interno del servidor. Por favor intente más tarde.',
      error: err.message 
    });
  } finally {
    client.release();
  }
});

// ACTUALIZAR ESPECIALISTA (PUT)
app.put('/especialistas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre_especialista, especialidad, cargo, telefono, correo } = req.body;
  
  try {
    const existingEspecialista = await pool.query(
      'SELECT id_especialista, id_usuario, correo FROM especialistas WHERE id_especialista = $1',
      [id]
    );
    
    if (existingEspecialista.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    const especialistaActual = existingEspecialista.rows[0];
    
    if (correo && correo !== especialistaActual.correo) {
      const existingCorreo = await pool.query(
        'SELECT id_especialista FROM especialistas WHERE correo = $1 AND id_especialista != $2',
        [correo, id]
      );
      
      if (existingCorreo.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          mensaje: `El correo "${correo}" ya está registrado por otro especialista.` 
        });
      }
    }
    
    const query = `
      UPDATE especialistas 
      SET 
        nombre_especialista = COALESCE($1, nombre_especialista),
        especialidad = COALESCE($2, especialidad),
        cargo = COALESCE($3, cargo),
        telefono = COALESCE($4, telefono),
        correo = COALESCE($5, correo)
      WHERE id_especialista = $6
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      nombre_especialista, 
      especialidad, 
      cargo, 
      telefono, 
      correo, 
      id
    ]);
    
    if (correo && correo !== especialistaActual.correo && especialistaActual.id_usuario) {
      await pool.query(
        'UPDATE usuarios SET correo = $1 WHERE id_usuario = $2',
        [correo, especialistaActual.id_usuario]
      );
    }
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Especialista actualizado correctamente' 
    });
    
  } catch (err) {
    console.error('❌ Error al actualizar especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// INACTIVAR ESPECIALISTA
app.put('/especialistas/:id/inactivar', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const especialistaResult = await client.query(
      'SELECT id_usuario, nombre_especialista FROM especialistas WHERE id_especialista = $1',
      [id]
    );
    
    if (especialistaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    const { id_usuario, nombre_especialista } = especialistaResult.rows[0];
    
    await client.query('UPDATE especialistas SET activo = false WHERE id_especialista = $1', [id]);
    
    if (id_usuario) {
      await client.query('UPDATE usuarios SET activo = false WHERE id_usuario = $1', [id_usuario]);
    }
    
    await client.query('COMMIT');
    
    console.log(`✅ Especialista inactivado: ${nombre_especialista}`);
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'inactivar',
      'especialista',
      id,
      `Especialista inactivado: ${nombre_especialista}`,
      getRequestIp(req)
    );
    
    res.json({ 
      success: true, 
      mensaje: `Especialista "${nombre_especialista}" inactivado correctamente. No podrá iniciar sesión.` 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al inactivar especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ACTIVAR ESPECIALISTA
app.put('/especialistas/:id/activar', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const especialistaResult = await client.query(
      'SELECT id_usuario, nombre_especialista FROM especialistas WHERE id_especialista = $1',
      [id]
    );
    
    if (especialistaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    const { id_usuario, nombre_especialista } = especialistaResult.rows[0];
    
    await client.query('UPDATE especialistas SET activo = true WHERE id_especialista = $1', [id]);
    
    if (id_usuario) {
      await client.query('UPDATE usuarios SET activo = true WHERE id_usuario = $1', [id_usuario]);
    }
    
    await client.query('COMMIT');
    
    console.log(`✅ Especialista activado: ${nombre_especialista}`);
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'activar',
      'especialista',
      id,
      `Especialista activado: ${nombre_especialista}`,
      getRequestIp(req)
    );
    
    res.json({ 
      success: true, 
      mensaje: `Especialista "${nombre_especialista}" activado correctamente. Ya puede iniciar sesión.` 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al activar especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ELIMINAR ESPECIALISTA (DELETE)
app.delete('/especialistas/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const especialistaResult = await client.query(
      'SELECT id_usuario FROM especialistas WHERE id_especialista = $1',
      [id]
    );
    
    if (especialistaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    const { id_usuario } = especialistaResult.rows[0];
    
    await client.query('DELETE FROM pacientes_especialistas WHERE id_especialista = $1', [id]);
    await client.query('DELETE FROM especialistas WHERE id_especialista = $1', [id]);
    
    if (id_usuario) {
      await client.query('DELETE FROM usuarios WHERE id_usuario = $1', [id_usuario]);
    }
    
    await client.query('COMMIT');
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'eliminar',
      'especialista',
      id,
      `Especialista eliminado: ${id}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ 
      success: true, 
      mensaje: 'Especialista eliminado correctamente' 
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al eliminar especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ==================== RUTAS PARA PACIENTES_ESPECIALISTAS ====================

// OBTENER PACIENTES ASIGNADOS A UN ESPECIALISTA
app.get('/especialistas/:id/pacientes-asignados', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        p.id_paciente,
        p.nombre_apellido,
        p.codigo_funauta,
        p.diagnostico_tea,
        p.activo
      FROM pacientes p
      INNER JOIN pacientes_especialistas pe ON p.id_paciente = pe.id_paciente
      WHERE pe.id_especialista = $1 AND p.activo = true
      ORDER BY p.nombre_apellido ASC
    `;
    
    const result = await pool.query(query, [id]);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener pacientes asignados:', err.message);
    res.status(200).json({ success: true, data: [] });
  }
});

// OBTENER PACIENTES NO ASIGNADOS A UN ESPECIALISTA
app.get('/especialistas/:id/pacientes-disponibles', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        p.id_paciente,
        p.nombre_apellido,
        p.codigo_funauta,
        p.diagnostico_tea,
        p.activo
      FROM pacientes p
      WHERE p.activo = true
      AND p.id_paciente NOT IN (
        SELECT id_paciente FROM pacientes_especialistas WHERE id_especialista = $1
      )
      ORDER BY p.nombre_apellido ASC
    `;
    
    const result = await pool.query(query, [id]);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener pacientes disponibles:', err.message);
    res.status(200).json({ success: true, data: [] });
  }
});

// OBTENER PACIENTES DE UN ESPECIALISTA
app.get('/especialistas/:id/pacientes', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        p.id_paciente,
        p.nombre_apellido,
        p.codigo_funauta,
        p.cedula_rif,
        p.genero,
        TO_CHAR(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
        TO_CHAR(p.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
        p.nacionalidad,
        p.carnet_discapacidad,
        p.diagnostico_tea,
        p.activo
      FROM pacientes p
      INNER JOIN pacientes_especialistas pe ON p.id_paciente = pe.id_paciente
      WHERE pe.id_especialista = $1 AND p.activo = true
      ORDER BY p.nombre_apellido ASC
    `;
    
    const result = await pool.query(query, [id]);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener pacientes del especialista:', err.message);
    res.status(200).json({ success: true, data: [] });
  }
});

// ASIGNAR PACIENTE A ESPECIALISTA
app.post('/especialistas/:id_especialista/asignar/:id_paciente', async (req, res) => {
  const { id_especialista, id_paciente } = req.params;
  
  try {
    const especialistaCheck = await pool.query(
      'SELECT activo FROM especialistas WHERE id_especialista = $1',
      [id_especialista]
    );
    
    if (especialistaCheck.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    if (!especialistaCheck.rows[0].activo) {
      return res.status(400).json({ 
        success: false, 
        mensaje: 'No se puede asignar pacientes a un especialista inactivo.' 
      });
    }
    
    const checkQuery = `
      SELECT * FROM pacientes_especialistas 
      WHERE id_especialista = $1 AND id_paciente = $2
    `;
    const checkResult = await pool.query(checkQuery, [id_especialista, id_paciente]);
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        mensaje: 'El paciente ya está asignado a este especialista' 
      });
    }
    
    const query = `
      INSERT INTO pacientes_especialistas (id_especialista, id_paciente)
      VALUES ($1, $2)
      RETURNING *
    `;
    
    await pool.query(query, [id_especialista, id_paciente]);
    
    res.status(200).json({ 
      success: true, 
      mensaje: 'Paciente asignado correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al asignar paciente:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// DESASIGNAR PACIENTE DE ESPECIALISTA
app.delete('/especialistas/:id_especialista/desasignar/:id_paciente', async (req, res) => {
  const { id_especialista, id_paciente } = req.params;
  
  try {
    const query = `
      DELETE FROM pacientes_especialistas 
      WHERE id_especialista = $1 AND id_paciente = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [id_especialista, id_paciente]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        mensaje: 'La asignación no existe' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      mensaje: 'Paciente desasignado correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al desasignar paciente:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTA DE LOGIN ====================

app.post('/login', async (req, res) => {
  const { correo, password, rol } = req.body;
  const ip = req.ip || req.connection?.remoteAddress || 'desconocido';

  // Normalizar valores cortos de rol que puede enviar el cliente (compatibilidad hacia atrás)
  const normalizeRole = (r) => {
    if (!r) return r;
    const map = {
      admin: 'administrador',
      specialist: 'especialista',
      parents: 'padre'
    };
    return map[r] || r;
  };

  const requestedRole = normalizeRole(rol);

  if (!correo || !password || !rol) {
    return res.status(400).json({ 
      success: false, 
      mensaje: "Correo, contraseña y rol son requeridos" 
    });
  }

  try {
    const query = `
      SELECT u.*, r.nombre as rol_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.id_rol = r.id_rol
      WHERE u.correo = $1 AND u.password = $2 AND u.activo = true
    `;
    const userResult = await pool.query(query, [correo, password]);
    
    if (userResult.rows.length === 0) {
      const usuarioInactivo = await pool.query(
        'SELECT activo FROM usuarios WHERE correo = $1',
        [correo]
      );
      
      if (usuarioInactivo.rows.length > 0 && usuarioInactivo.rows[0].activo === false) {
        // Registrar intento fallido por usuario inactivo
        await registrarAuditoria(
          null,
          correo,
          rol,
          'login_fallido',
          'usuario',
          null,
          `Intento de login fallido: usuario inactivo - IP: ${ip}`,
          ip
        );
        
        return res.status(401).json({ 
          success: false, 
          mensaje: "Usuario inactivo. Contacte al administrador para reactivar su cuenta." 
        });
      }
      
      // Registrar intento fallido por credenciales incorrectas
      await registrarAuditoria(
        null,
        correo,
        requestedRole,
        'login_fallido',
        'usuario',
        null,
        `Intento de login fallido: credenciales incorrectas - IP: ${ip}`,
        ip
      );
      
      return res.status(401).json({ 
        success: false, 
        mensaje: "Correo o contraseña incorrectos" 
      });
    }
    
    const usuario = userResult.rows[0];
    const rolNombre = usuario.rol_nombre;
    
    if (rolNombre !== requestedRole) {
      // Registrar intento fallido por rol incorrecto
      await registrarAuditoria(
        usuario.id_usuario,
        correo,
        rolNombre,
        'login_fallido',
        'usuario',
        usuario.id_usuario,
        `Intento de login con rol incorrecto: intentó "${rol}" pero es "${rolNombre}" - IP: ${ip}`,
        ip
      );
      
      return res.status(401).json({ 
        success: false, 
        mensaje: `No tienes acceso como "${rol}". Tu rol es "${rolNombre}".` 
      });
    }
    
    let id_especialista = null;
    let especialidadReal = null;
    let nombreEspecialista = null;
    let id_padre = null;
    let nombrePadre = null;
    
    if (rolNombre === 'especialista') {
      const espResult = await pool.query(
        "SELECT id_especialista, especialidad, nombre_especialista FROM especialistas WHERE correo = $1 AND activo = true", 
        [correo]
      );
      if (espResult.rows.length > 0) {
        id_especialista = espResult.rows[0].id_especialista;
        especialidadReal = espResult.rows[0].especialidad;
        nombreEspecialista = espResult.rows[0].nombre_especialista;
      }
    }
    
    if (rolNombre === 'padre') {
      const padreResult = await pool.query(
        "SELECT id_padre, nombre_padre FROM padres WHERE correo = $1 AND activo = true", 
        [correo]
      );
      if (padreResult.rows.length > 0) {
        id_padre = padreResult.rows[0].id_padre;
        nombrePadre = padreResult.rows[0].nombre_padre;
      }
    }
    
    // Registrar LOGIN EXITOSO
    await registrarAuditoria(
      usuario.id_usuario,
      correo,
      rolNombre,
      'login',
      'usuario',
      usuario.id_usuario,
      `Login exitoso - IP: ${ip}`,
      ip
    );
    
    console.log(`✅ Login exitoso: ${correo} - Rol: ${rolNombre} - ${new Date().toLocaleString()}`);
    
    res.status(200).json({ 
      success: true,
      mensaje: "Login exitoso",
      user: {
        id_usuario: usuario.id_usuario,
        correo: usuario.correo,
        rol: rolNombre,
        id_especialista: id_especialista,
        especialidad: especialidadReal,
        nombre_especialista: nombreEspecialista,
        id_padre: id_padre,
        nombre_padre: nombrePadre
      }
    });
    
  } catch (err) {
    console.error('❌ Error en login:', err.message);
    
    // Registrar error del servidor
    await registrarAuditoria(
      null,
      correo,
      requestedRole,
      'error',
      'sistema',
      null,
      `Error en login: ${err.message} - IP: ${ip}`,
      ip
    );
    
    res.status(500).json({ 
      success: false, 
      mensaje: "Error interno del servidor. Intente más tarde." 
    });
  }
});

// ==================== RUTAS PARA PADRES ====================

// OBTENER TODOS LOS PADRES
app.get('/padres', async (req, res) => {
  const { correo, id, solo_activos } = req.query;
  
  try {
    let query = `
      SELECT 
        p.id_padre,
        p.nombre_padre,
        p.cedula_padre,
        p.parentesco,
        p.telefono,
        p.correo,
        p.direccion,
        p.estado_capacitacion,
        p.activo,
        p.id_usuario,
        u.activo as usuario_activo
      FROM padres p
      LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
      WHERE 1=1
    `;
    
    let values = [];
    let idx = 1;
    
    if (correo) {
      query += ` AND p.correo = $${idx++}`;
      values.push(correo);
    }
    
    if (id) {
      query += ` AND p.id_padre = $${idx++}`;
      values.push(id);
    }
    
    if (solo_activos === 'true') {
      query += ` AND p.activo = true`;
    }
    
    query += ` ORDER BY p.nombre_padre ASC`;
    
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener padres:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER UN PADRE POR ID
app.get('/padres/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        p.id_padre,
        p.nombre_padre,
        p.cedula_padre,
        p.parentesco,
        p.telefono,
        p.correo,
        p.direccion,
        p.estado_capacitacion,
        p.activo,
        p.id_usuario
      FROM padres p
      WHERE p.id_padre = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Padre no encontrado' });
    }
    
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error al obtener padre por ID:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// REGISTRAR NUEVO PADRE
app.post('/padres', async (req, res) => {
  const { 
    nombre, 
    cedula, 
    parentesco, 
    telefono, 
    correo, 
    direccion, 
    estado_capacitacion, 
    password,
    activo 
  } = req.body;
  
  console.log('📝 Datos recibidos para crear padre:', { nombre, correo, cedula, parentesco });
  
  const errores = [];
  
  if (!nombre || nombre.trim() === '') {
    errores.push('El nombre completo es requerido');
  }
  
  if (!correo || correo.trim() === '') {
    errores.push('El correo electrónico es requerido');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    errores.push('El formato del correo electrónico no es válido');
  }
  
  if (!password || password.trim() === '') {
    errores.push('La contraseña es requerida');
  } else if (password.length < 3) {
    errores.push('La contraseña debe tener al menos 3 caracteres');
  }
  
  if (errores.length > 0) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'Por favor corrija los siguientes errores:',
      errores: errores
    });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const existingUser = await client.query(
      'SELECT id_usuario FROM usuarios WHERE correo = $1',
      [correo.trim().toLowerCase()]
    );
    
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        mensaje: `El correo "${correo}" ya está registrado. Use otro correo.` 
      });
    }
    
    const existingPadre = await client.query(
      'SELECT id_padre FROM padres WHERE correo = $1',
      [correo.trim().toLowerCase()]
    );
    
    if (existingPadre.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        mensaje: `El correo "${correo}" ya está registrado como padre.` 
      });
    }
    
    if (cedula && cedula.trim() !== '') {
      const existingCedula = await client.query(
        'SELECT id_padre FROM padres WHERE cedula_padre = $1',
        [cedula.trim()]
      );
      
      if (existingCedula.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false, 
          mensaje: `La cédula "${cedula}" ya está registrada.` 
        });
      }
    }
    
    const rolResult = await client.query(
      "SELECT id_rol FROM roles WHERE nombre = 'padre'"
    );
    
    let idRol = 4;
    if (rolResult.rows.length > 0) {
      idRol = rolResult.rows[0].id_rol;
    }
    
    const userResult = await client.query(
      `INSERT INTO usuarios (correo, password, id_rol, activo) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id_usuario`,
      [correo.trim().toLowerCase(), password, idRol, activo !== undefined ? activo : true]
    );
    
    const idUsuario = userResult.rows[0].id_usuario;
    console.log('✅ Usuario creado con ID:', idUsuario);
    
    const padreResult = await client.query(
      `INSERT INTO padres (
        nombre_padre, 
        cedula_padre, 
        parentesco, 
        telefono, 
        correo, 
        direccion, 
        estado_capacitacion, 
        id_usuario,
        activo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING *`,
      [
        nombre.trim(), 
        cedula && cedula.trim() !== '' ? cedula.trim() : null, 
        parentesco && parentesco.trim() !== '' ? parentesco.trim() : 'Padre', 
        telefono && telefono.trim() !== '' ? telefono.trim() : null, 
        correo.trim().toLowerCase(), 
        direccion && direccion.trim() !== '' ? direccion.trim() : null, 
        estado_capacitacion || 'pendiente', 
        idUsuario,
        true
      ]
    );
    
    console.log('✅ Padre creado con ID:', padreResult.rows[0].id_padre);
    
    await client.query('COMMIT');
    await registrarAuditoria(
      null,
      correo.trim().toLowerCase(),
      'sistema',
      'crear',
      'padre',
      padreResult.rows[0].id_padre,
      `Padre registrado: ${padreResult.rows[0].nombre_padre}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ 
      success: true, 
      data: padreResult.rows[0], 
      mensaje: 'Padre registrado exitosamente. Ya puede iniciar sesión.' 
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al registrar padre:', err.message);
    res.status(500).json({ 
      success: false, 
      mensaje: 'Error interno del servidor. Por favor intente más tarde.',
      error: err.message 
    });
  } finally {
    client.release();
  }
});

// ACTUALIZAR PADRE
app.put('/padres/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, cedula, parentesco, telefono, correo, direccion, estado_capacitacion } = req.body;
  
  try {
    const existingPadre = await pool.query(
      'SELECT id_padre, id_usuario, correo FROM padres WHERE id_padre = $1',
      [id]
    );
    
    if (existingPadre.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Padre no encontrado' });
    }
    
    const padreActual = existingPadre.rows[0];
    
    if (correo && correo !== padreActual.correo) {
      const existingCorreo = await pool.query(
        'SELECT id_padre FROM padres WHERE correo = $1 AND id_padre != $2',
        [correo, id]
      );
      
      if (existingCorreo.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          mensaje: `El correo "${correo}" ya está registrado por otro padre.` 
        });
      }
    }
    
    if (cedula && cedula !== padreActual.cedula_padre) {
      const existingCedula = await pool.query(
        'SELECT id_padre FROM padres WHERE cedula_padre = $1 AND id_padre != $2',
        [cedula, id]
      );
      
      if (existingCedula.rows.length > 0) {
        return res.status(400).json({ 
          success: false, 
          mensaje: `La cédula "${cedula}" ya está registrada por otro padre.` 
        });
      }
    }
    
    const query = `
      UPDATE padres 
      SET 
        nombre_padre = COALESCE($1, nombre_padre),
        cedula_padre = COALESCE($2, cedula_padre),
        parentesco = COALESCE($3, parentesco),
        telefono = COALESCE($4, telefono),
        correo = COALESCE($5, correo),
        direccion = COALESCE($6, direccion),
        estado_capacitacion = COALESCE($7, estado_capacitacion)
      WHERE id_padre = $8
      RETURNING *
    `;
    
    const values = [
      nombre || padreActual.nombre_padre, 
      cedula !== undefined ? (cedula || null) : padreActual.cedula_padre, 
      parentesco || padreActual.parentesco, 
      telefono !== undefined ? (telefono || null) : padreActual.telefono, 
      correo || padreActual.correo, 
      direccion !== undefined ? (direccion || null) : padreActual.direccion, 
      estado_capacitacion || padreActual.estado_capacitacion, 
      id
    ];
    
    const result = await pool.query(query, values);
    
    if (correo && correo !== padreActual.correo && padreActual.id_usuario) {
      await pool.query(
        'UPDATE usuarios SET correo = $1 WHERE id_usuario = $2',
        [correo, padreActual.id_usuario]
      );
    }
    
    await registrarAuditoria(
      padreActual.id_usuario || null,
      padreActual.correo || null,
      'padre',
      'actualizar',
      'padre',
      id,
      `Padre actualizado: ${id}`,
      getRequestIp(req)
    );
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Padre actualizado correctamente' 
    });
    
  } catch (err) {
    console.error('❌ Error al actualizar padre:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// INACTIVAR PADRE
app.put('/padres/:id/inactivar', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const padreResult = await client.query(
      'SELECT id_usuario, nombre_padre FROM padres WHERE id_padre = $1',
      [id]
    );
    
    if (padreResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Padre no encontrado' });
    }
    
    const { id_usuario, nombre_padre } = padreResult.rows[0];
    
    await client.query('UPDATE padres SET activo = false WHERE id_padre = $1', [id]);
    
    if (id_usuario) {
      await client.query('UPDATE usuarios SET activo = false WHERE id_usuario = $1', [id_usuario]);
    }
    
    await client.query('COMMIT');
    await registrarAuditoria(
      id_usuario || null,
      null,
      'padre',
      'inactivar',
      'padre',
      id,
      `Padre inactivado: ${nombre_padre}`,
      getRequestIp(req)
    );
    
    console.log(`✅ Padre inactivado: ${nombre_padre} (ID: ${id})`);
    
    res.json({ 
      success: true, 
      mensaje: `Padre "${nombre_padre}" inactivado correctamente. No podrá iniciar sesión.` 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al inactivar padre:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ACTIVAR PADRE
app.put('/padres/:id/activar', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const padreResult = await client.query(
      'SELECT id_usuario, nombre_padre FROM padres WHERE id_padre = $1',
      [id]
    );
    
    if (padreResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Padre no encontrado' });
    }
    
    const { id_usuario, nombre_padre } = padreResult.rows[0];
    
    await client.query('UPDATE padres SET activo = true WHERE id_padre = $1', [id]);
    
    if (id_usuario) {
      await client.query('UPDATE usuarios SET activo = true WHERE id_usuario = $1', [id_usuario]);
    }
    
    await client.query('COMMIT');
    await registrarAuditoria(
      id_usuario || null,
      null,
      'padre',
      'activar',
      'padre',
      id,
      `Padre activado: ${nombre_padre}`,
      getRequestIp(req)
    );
    
    console.log(`✅ Padre activado: ${nombre_padre} (ID: ${id})`);
    
    res.json({ 
      success: true, 
      mensaje: `Padre "${nombre_padre}" activado correctamente. Ya puede iniciar sesión.` 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al activar padre:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// VINCULAR PADRE CON PACIENTE
app.post('/padres/:id_padre/vincular/:id_paciente', async (req, res) => {
  const { id_padre, id_paciente } = req.params;
  
  try {
    const padreCheck = await pool.query(
      'SELECT id_padre, nombre_padre, activo FROM padres WHERE id_padre = $1',
      [id_padre]
    );
    
    if (padreCheck.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Padre no encontrado' });
    }
    
    if (!padreCheck.rows[0].activo) {
      return res.status(400).json({ 
        success: false, 
        mensaje: `No se puede vincular el padre "${padreCheck.rows[0].nombre_padre}" porque está inactivo.` 
      });
    }
    
    const pacienteCheck = await pool.query(
      'SELECT id_paciente, nombre_apellido FROM pacientes WHERE id_paciente = $1',
      [id_paciente]
    );
    
    if (pacienteCheck.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
    }
    
    const vinculacionActual = await pool.query(
      'SELECT id_padre FROM pacientes WHERE id_paciente = $1 AND id_padre IS NOT NULL',
      [id_paciente]
    );
    
    if (vinculacionActual.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        mensaje: 'El paciente ya tiene un padre/tutor asignado. Desvincule primero.' 
      });
    }
    
    const result = await pool.query(
      'UPDATE pacientes SET id_padre = $1 WHERE id_paciente = $2 RETURNING *',
      [id_padre, id_paciente]
    );
    
    console.log(`✅ Padre ${padreCheck.rows[0].nombre_padre} vinculado al paciente ${pacienteCheck.rows[0].nombre_apellido}`);
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0],
      mensaje: `Padre "${padreCheck.rows[0].nombre_padre}" vinculado al paciente correctamente.` 
    });
    
  } catch (err) {
    console.error('❌ Error al vincular padre con paciente:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// DESVINCULAR PADRE DE PACIENTE
app.delete('/padres/:id_padre/desvincular/:id_paciente', async (req, res) => {
  const { id_padre, id_paciente } = req.params;
  
  try {
    const result = await pool.query(
      'UPDATE pacientes SET id_padre = NULL WHERE id_paciente = $1 AND id_padre = $2 RETURNING *',
      [id_paciente, id_padre]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        mensaje: 'No se encontró la vinculación entre este padre y paciente.' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      mensaje: 'Padre desvinculado del paciente correctamente.' 
    });
    
  } catch (err) {
    console.error('❌ Error al desvincular padre:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER PACIENTES DE UN PADRE
app.get('/padres/:id_padre/pacientes', async (req, res) => {
  const { id_padre } = req.params;
  const { solo_activos } = req.query;
  
  try {
    let query = `
      SELECT 
        p.id_paciente,
        p.nombre_apellido,
        p.codigo_funauta,
        p.cedula_rif,
        p.genero,
        TO_CHAR(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
        TO_CHAR(p.fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
        p.diagnostico_tea,
        p.activo,
        p.documento_tea_url,
        p.documento_tea_nombre
      FROM pacientes p
      WHERE p.id_padre = $1
    `;
    
    const values = [id_padre];
    
    if (solo_activos === 'true') {
      query += ` AND p.activo = true`;
    }
    
    query += ` ORDER BY p.nombre_apellido ASC`;
    
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener pacientes del padre:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ELIMINAR PADRE
app.delete('/padres/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const padreResult = await client.query(
      'SELECT id_usuario, nombre_padre FROM padres WHERE id_padre = $1',
      [id]
    );
    
    if (padreResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Padre no encontrado' });
    }
    
    const { id_usuario, nombre_padre } = padreResult.rows[0];
    
    await client.query('UPDATE pacientes SET id_padre = NULL WHERE id_padre = $1', [id]);
    await client.query('DELETE FROM padres WHERE id_padre = $1', [id]);
    
    if (id_usuario) {
      await client.query('DELETE FROM usuarios WHERE id_usuario = $1', [id_usuario]);
    }
    
    await client.query('COMMIT');
    await registrarAuditoria(
      id_usuario || null,
      null,
      'padre',
      'eliminar',
      'padre',
      id,
      `Padre eliminado: ${nombre_padre}`,
      getRequestIp(req)
    );
    
    console.log(`✅ Padre eliminado: ${nombre_padre} (ID: ${id})`);
    
    res.status(200).json({ 
      success: true, 
      mensaje: `Padre "${nombre_padre}" eliminado correctamente.` 
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al eliminar padre:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ==================== RUTAS PARA CITAS ====================

// OBTENER TODAS LAS CITAS
app.get('/citas', async (req, res) => {
  const { id_especialista, id_paciente, estado, fecha_inicio, fecha_fin, solo_activos } = req.query;
  
  try {
    let query = `
      SELECT 
        c.id_cita,
        c.fecha_cita,
        c.hora_cita,
        c.tipo_cita,
        c.estado,
        c.observaciones,
        c.created_at,
        p.id_paciente,
        p.nombre_apellido as paciente_nombre,
        p.activo as paciente_activo,
        p.codigo_funauta,
        p.cedula_rif,
        p.diagnostico_tea,
        e.id_especialista,
        e.nombre_especialista as especialista_nombre,
        e.activo as especialista_activo,
        e.especialidad
      FROM citas c
      JOIN pacientes p ON c.id_paciente = p.id_paciente
      JOIN especialistas e ON c.id_especialista = e.id_especialista
      WHERE 1=1
    `;
    
    let values = [];
    let conditions = [];
    let idx = 1;
    
    if (id_especialista) {
      conditions.push(`c.id_especialista = $${idx++}`);
      values.push(id_especialista);
    }
    if (id_paciente) {
      conditions.push(`c.id_paciente = $${idx++}`);
      values.push(id_paciente);
    }
    if (estado) {
      conditions.push(`c.estado = $${idx++}`);
      values.push(estado);
    }
    if (fecha_inicio) {
      conditions.push(`c.fecha_cita >= $${idx++}`);
      values.push(fecha_inicio);
    }
    if (fecha_fin) {
      conditions.push(`c.fecha_cita <= $${idx++}`);
      values.push(fecha_fin);
    }
    
    if (solo_activos === 'true') {
      conditions.push(`p.activo = true AND e.activo = true`);
    }
    
    if (conditions.length > 0) {
      query += ` AND ${conditions.join(' AND ')}`;
    }
    
    query += ` ORDER BY c.fecha_cita DESC, c.hora_cita DESC`;
    
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener citas:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER UNA CITA POR ID
app.get('/citas/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        c.id_cita,
        c.fecha_cita,
        c.hora_cita,
        c.tipo_cita,
        c.estado,
        c.observaciones,
        c.created_at,
        p.id_paciente,
        p.nombre_apellido as paciente_nombre,
        p.activo as paciente_activo,
        p.codigo_funauta,
        p.cedula_rif,
        e.id_especialista,
        e.nombre_especialista as especialista_nombre,
        e.activo as especialista_activo,
        e.especialidad
      FROM citas c
      JOIN pacientes p ON c.id_paciente = p.id_paciente
      JOIN especialistas e ON c.id_especialista = e.id_especialista
      WHERE c.id_cita = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Cita no encontrada' });
    }
    
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error al obtener cita:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// CREAR NUEVA CITA
app.post('/citas', async (req, res) => {
  const { id_paciente, id_especialista, fecha_cita, hora_cita, tipo_cita, observaciones } = req.body;
  
  const errores = [];
  if (!id_paciente) errores.push('El paciente es requerido');
  if (!id_especialista) errores.push('El especialista es requerido');
  if (!fecha_cita) errores.push('La fecha es requerida');
  if (!hora_cita) errores.push('La hora es requerida');
  
  if (errores.length > 0) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'Por favor complete todos los campos requeridos',
      errores: errores
    });
  }
  
  const pacienteCheck = await pool.query(
    'SELECT activo FROM pacientes WHERE id_paciente = $1',
    [id_paciente]
  );
  
  if (pacienteCheck.rows.length === 0) {
    return res.status(400).json({ success: false, mensaje: 'Paciente no encontrado' });
  }
  
  if (!pacienteCheck.rows[0].activo) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'No se puede agendar una cita con un paciente inactivo. Primero debe activarlo.' 
    });
  }
  
  const especialistaCheck = await pool.query(
    'SELECT activo FROM especialistas WHERE id_especialista = $1',
    [id_especialista]
  );
  
  if (especialistaCheck.rows.length === 0) {
    return res.status(400).json({ success: false, mensaje: 'Especialista no encontrado' });
  }
  
  if (!especialistaCheck.rows[0].activo) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'No se puede agendar una cita con un especialista inactivo. Primero debe activarlo.' 
    });
  }
  
  try {
    const query = `
      INSERT INTO citas (id_paciente, id_especialista, fecha_cita, hora_cita, tipo_cita, observaciones, estado)
      VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')
      RETURNING *
    `;
    
    const result = await pool.query(query, [id_paciente, id_especialista, fecha_cita, hora_cita, tipo_cita || 'consulta', observaciones || null]);
    
    console.log(`✅ Cita creada: ${fecha_cita} ${hora_cita} - Paciente ID: ${id_paciente}, Especialista ID: ${id_especialista}`);
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'crear',
      'cita',
      result.rows[0].id_cita,
      `Cita creada para paciente ${id_paciente} con especialista ${id_especialista}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Cita agendada correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al crear cita:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ACTUALIZAR CITA
app.put('/citas/:id', async (req, res) => {
  const { id } = req.params;
  const { fecha_cita, hora_cita, estado, observaciones, evaluacion, calificacion, id_paciente, id_especialista } = req.body;
  
  try {
    const citaExistente = await pool.query(
      'SELECT id_cita, id_paciente, id_especialista FROM citas WHERE id_cita = $1',
      [id]
    );
    
    if (citaExistente.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Cita no encontrada' });
    }
    
    if (id_paciente && id_paciente !== citaExistente.rows[0].id_paciente) {
      const pacienteCheck = await pool.query(
        'SELECT activo FROM pacientes WHERE id_paciente = $1',
        [id_paciente]
      );
      
      if (pacienteCheck.rows.length === 0) {
        return res.status(400).json({ success: false, mensaje: 'Paciente no encontrado' });
      }
      
      if (!pacienteCheck.rows[0].activo) {
        return res.status(400).json({ 
          success: false, 
          mensaje: 'No se puede asignar un paciente inactivo a esta cita.' 
        });
      }
    }
    
    if (id_especialista && id_especialista !== citaExistente.rows[0].id_especialista) {
      const especialistaCheck = await pool.query(
        'SELECT activo FROM especialistas WHERE id_especialista = $1',
        [id_especialista]
      );
      
      if (especialistaCheck.rows.length === 0) {
        return res.status(400).json({ success: false, mensaje: 'Especialista no encontrado' });
      }
      
      if (!especialistaCheck.rows[0].activo) {
        return res.status(400).json({ 
          success: false, 
          mensaje: 'No se puede asignar un especialista inactivo a esta cita.' 
        });
      }
    }
    
    const updates = [];
    const values = [];
    let idx = 1;
    
    if (fecha_cita !== undefined) {
      updates.push(`fecha_cita = $${idx++}`);
      values.push(fecha_cita);
    }
    if (hora_cita !== undefined) {
      updates.push(`hora_cita = $${idx++}`);
      values.push(hora_cita);
    }
    if (estado !== undefined) {
      updates.push(`estado = $${idx++}`);
      values.push(estado);
    }
    if (observaciones !== undefined) {
      updates.push(`observaciones = $${idx++}`);
      values.push(observaciones);
    }
    if (evaluacion !== undefined) {
      updates.push(`evaluacion = $${idx++}`);
      values.push(evaluacion);
    }
    if (calificacion !== undefined) {
      updates.push(`calificacion = $${idx++}`);
      values.push(calificacion);
    }
    if (id_paciente !== undefined) {
      updates.push(`id_paciente = $${idx++}`);
      values.push(id_paciente);
    }
    if (id_especialista !== undefined) {
      updates.push(`id_especialista = $${idx++}`);
      values.push(id_especialista);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay datos para actualizar' });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    const query = `UPDATE citas SET ${updates.join(', ')} WHERE id_cita = $${idx} RETURNING *`;
    values.push(id);
    
    const result = await pool.query(query, values);
    
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'actualizar',
      'cita',
      id,
      `Cita actualizada: ${id}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Cita actualizada correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al actualizar cita:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ELIMINAR CITA
app.delete('/citas/:id', async (req, res) => {
  const { id } = req.params;
  const { permanente } = req.query;
  
  try {
    if (permanente === 'true') {
      const result = await pool.query('DELETE FROM citas WHERE id_cita = $1 RETURNING id_cita', [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, mensaje: 'Cita no encontrada' });
      }
      await registrarAuditoria(
        null,
        null,
        'sistema',
        'eliminar',
        'cita',
        id,
        `Cita eliminada permanentemente: ${id}`,
        getRequestIp(req)
      );
      return res.status(200).json({ success: true, mensaje: 'Cita eliminada permanentemente' });
    }
    
    const result = await pool.query(
      'UPDATE citas SET estado = $1, updated_at = CURRENT_TIMESTAMP WHERE id_cita = $2 RETURNING id_cita',
      ['cancelada', id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Cita no encontrada' });
    }
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'cancelar',
      'cita',
      id,
      `Cita cancelada: ${id}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ success: true, mensaje: 'Cita cancelada correctamente' });
  } catch (err) {
    console.error('❌ Error al eliminar/cancelar cita:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER CITAS POR ESPECIALISTA
app.get('/especialistas/:id/citas', async (req, res) => {
  const { id } = req.params;
  const { estado, fecha, incluir_inactivos } = req.query;
  
  try {
    let query = `
      SELECT 
        c.id_cita,
        c.fecha_cita,
        c.hora_cita,
        c.tipo_cita,
        c.estado,
        c.observaciones,
        p.id_paciente,
        p.nombre_apellido as paciente_nombre,
        p.activo as paciente_activo,
        p.codigo_funauta,
        p.diagnostico_tea
      FROM citas c
      JOIN pacientes p ON c.id_paciente = p.id_paciente
      WHERE c.id_especialista = $1
    `;
    
    let values = [id];
    let idx = 2;
    
    if (estado) {
      query += ` AND c.estado = $${idx++}`;
      values.push(estado);
    }
    if (fecha) {
      query += ` AND c.fecha_cita = $${idx++}`;
      values.push(fecha);
    }
    
    if (incluir_inactivos !== 'true') {
      query += ` AND p.activo = true`;
    }
    
    query += ` ORDER BY c.fecha_cita ASC, c.hora_cita ASC`;
    
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener citas del especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER CITAS PENDIENTES DE UN ESPECIALISTA
app.get('/especialistas/:id/citas-pendientes', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        c.id_cita,
        c.fecha_cita,
        c.hora_cita,
        c.tipo_cita,
        c.estado,
        c.observaciones,
        p.id_paciente,
        p.nombre_apellido as paciente_nombre,
        p.activo as paciente_activo,
        p.codigo_funauta,
        p.diagnostico_tea
      FROM citas c
      JOIN pacientes p ON c.id_paciente = p.id_paciente
      WHERE c.id_especialista = $1 
        AND c.estado = 'pendiente'
        AND c.fecha_cita >= CURRENT_DATE
        AND p.activo = true
      ORDER BY c.fecha_cita ASC, c.hora_cita ASC
    `;
    
    const result = await pool.query(query, [id]);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener citas pendientes:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA EVALUACIONES (CON TABLA INTERMEDIA) ====================

// OBTENER EVALUACIONES DE UN PACIENTE (CON ESPECIALISTAS)
app.get('/pacientes/:id/evaluaciones', async (req, res) => {
  const { id } = req.params;
  
  try {
    const query = `
      SELECT 
        e.id_evaluacion,
        e.fecha_evaluacion,
        e.tipo_evaluacion,
        e.nombre_evaluacion,
        e.puntuacion_resultado,
        e.percentil,
        e.interpretacion,
        e.observaciones_tecnicas,
        e.recomendaciones,
        e.requiere_lenguaje,
        e.requiere_ocupacional,
        e.requiere_psicopedagogia,
        e.requiere_fisico,
        e.cantidad_sesiones,
        e.tipo_periodo,
        e.proxima_cita,
        e.recibe_medicamentos,
        e.cuales_medicamentos,
        e.especialista_externo,
        e.externo_fecha_consulta,
        e.externo_diagnostico,
        e.externo_tratamiento,
        e.externo_derivado_por,
        e.created_at,
        e.updated_at,
        COALESCE(e.puntuacion_resultado, 0) as resultado,
        COALESCE(
          (SELECT json_agg(
            json_build_object(
              'id_eval_esp', ee.id_eval_esp,
              'id_especialista', es.id_especialista,
              'nombre_especialista', es.nombre_especialista,
              'especialidad', es.especialidad,
              'rol', ee.rol,
              'horas_dedicadas', ee.horas_dedicadas,
              'fecha_asignacion', ee.fecha_asignacion
            )
            ORDER BY ee.fecha_asignacion DESC
          ) 
          FROM evaluacion_especialistas ee
          JOIN especialistas es ON ee.id_especialista = es.id_especialista
          WHERE ee.id_evaluacion = e.id_evaluacion AND ee.activo = true
          ), '[]'::json
        ) as especialistas
      FROM evaluaciones e
      WHERE e.id_paciente = $1
      ORDER BY e.fecha_evaluacion DESC, e.created_at DESC
    `;
    
    const result = await pool.query(query, [id]);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener evaluaciones:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// REGISTRAR NUEVA EVALUACIÓN (CON MÚLTIPLES ESPECIALISTAS)
app.post('/evaluaciones', async (req, res) => {
  const {
    id_paciente,
    especialistas,
    tipo_evaluacion,
    nombre_evaluacion,
    puntuacion_resultado,
    interpretacion,
    observaciones_tecnicas,
    recomendaciones,
    fecha_evaluacion,
    requiere_lenguaje,
    requiere_ocupacional,
    requiere_psicopedagogia,
    requiere_fisico,
    cantidad_sesiones,
    percentil,
    proxima_cita,
    recibe_medicamentos,
    cuales_medicamentos,
    tipo_periodo,
    especialista_externo,
    externo_fecha_consulta,
    externo_diagnostico,
    externo_tratamiento,
    externo_derivado_por
  } = req.body;
  
  if (!id_paciente) {
    return res.status(400).json({ success: false, mensaje: 'ID de paciente es requerido' });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const pacienteCheck = await client.query(
      'SELECT id_paciente, activo, nombre_apellido FROM pacientes WHERE id_paciente = $1',
      [id_paciente]
    );
    
    if (pacienteCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Paciente no encontrado' });
    }
    
    const fechaActual = new Date().toISOString().split('T')[0];
    
    const evalQuery = `
      INSERT INTO evaluaciones (
        id_paciente,
        tipo_evaluacion,
        nombre_evaluacion,
        puntuacion_resultado,
        interpretacion,
        observaciones_tecnicas,
        recomendaciones,
        fecha_evaluacion,
        requiere_lenguaje,
        requiere_ocupacional,
        requiere_psicopedagogia,
        requiere_fisico,
        cantidad_sesiones,
        percentil,
        proxima_cita,
        recibe_medicamentos,
        cuales_medicamentos,
        tipo_periodo,
        especialista_externo,
        externo_fecha_consulta,
        externo_diagnostico,
        externo_tratamiento,
        externo_derivado_por,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW(), NOW())
      RETURNING *
    `;
    
    const evalValues = [
      id_paciente,
      tipo_evaluacion || 'Evaluación Regular',
      nombre_evaluacion || null,
      puntuacion_resultado || 0,
      interpretacion || null,
      observaciones_tecnicas || null,
      recomendaciones || null,
      fecha_evaluacion || fechaActual,
      requiere_lenguaje || false,
      requiere_ocupacional || false,
      requiere_psicopedagogia || false,
      requiere_fisico || false,
      cantidad_sesiones || null,
      percentil || null,
      proxima_cita || null,
      recibe_medicamentos || false,
      cuales_medicamentos || null,
      tipo_periodo || null,
      especialista_externo || null,
      externo_fecha_consulta || null,
      externo_diagnostico || null,
      externo_tratamiento || null,
      externo_derivado_por || null
    ];
    
    const evalResult = await client.query(evalQuery, evalValues);
    const nuevaEvaluacion = evalResult.rows[0];
    
    if (especialistas && Array.isArray(especialistas) && especialistas.length > 0) {
      for (const esp of especialistas) {
        if (esp.id_especialista) {
          const espCheck = await client.query(
            'SELECT id_especialista, activo FROM especialistas WHERE id_especialista = $1',
            [esp.id_especialista]
          );
          
          if (espCheck.rows.length > 0 && espCheck.rows[0].activo) {
            await client.query(
              `INSERT INTO evaluacion_especialistas 
               (id_evaluacion, id_especialista, id_paciente, rol, horas_dedicadas, fecha_asignacion, activo)
               VALUES ($1, $2, $3, $4, $5, NOW(), true)`,
              [
                nuevaEvaluacion.id_evaluacion,
                esp.id_especialista,
                id_paciente,
                esp.rol || 'Evaluador',
                esp.horas_dedicadas || null
              ]
            );
          }
        }
      }
    }
    
    await client.query('COMMIT');
    
    console.log(`✅ Evaluación registrada para paciente: ${pacienteCheck.rows[0].nombre_apellido}`);
    
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'crear',
      'evaluacion',
      nuevaEvaluacion.id_evaluacion,
      `Evaluación registrada para paciente ${pacienteCheck.rows[0].nombre_apellido}`,
      getRequestIp(req)
    );
    
    res.status(201).json({ 
      success: true, 
      data: nuevaEvaluacion, 
      mensaje: 'Evaluación registrada correctamente' 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al registrar evaluación:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ACTUALIZAR EVALUACIÓN
app.put('/evaluaciones/:id', async (req, res) => {
  const { id } = req.params;
  const {
    especialistas,
    tipo_evaluacion,
    nombre_evaluacion,
    puntuacion_resultado,
    interpretacion,
    observaciones_tecnicas,
    recomendaciones,
    fecha_evaluacion,
    requiere_lenguaje,
    requiere_ocupacional,
    requiere_psicopedagogia,
    requiere_fisico,
    cantidad_sesiones,
    percentil,
    proxima_cita,
    recibe_medicamentos,
    cuales_medicamentos,
    tipo_periodo,
    especialista_externo,
    externo_fecha_consulta,
    externo_diagnostico,
    externo_tratamiento,
    externo_derivado_por
  } = req.body;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const evalCheck = await client.query(
      'SELECT id_evaluacion FROM evaluaciones WHERE id_evaluacion = $1',
      [id]
    );
    
    if (evalCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, mensaje: 'Evaluación no encontrada' });
    }
    
    const updateQuery = `
      UPDATE evaluaciones 
      SET 
        tipo_evaluacion = COALESCE($1, tipo_evaluacion),
        nombre_evaluacion = COALESCE($2, nombre_evaluacion),
        puntuacion_resultado = COALESCE($3, puntuacion_resultado),
        interpretacion = COALESCE($4, interpretacion),
        observaciones_tecnicas = COALESCE($5, observaciones_tecnicas),
        recomendaciones = COALESCE($6, recomendaciones),
        fecha_evaluacion = COALESCE($7, fecha_evaluacion),
        requiere_lenguaje = COALESCE($8, requiere_lenguaje),
        requiere_ocupacional = COALESCE($9, requiere_ocupacional),
        requiere_psicopedagogia = COALESCE($10, requiere_psicopedagogia),
        requiere_fisico = COALESCE($11, requiere_fisico),
        cantidad_sesiones = COALESCE($12, cantidad_sesiones),
        percentil = COALESCE($13, percentil),
        proxima_cita = COALESCE($14, proxima_cita),
        recibe_medicamentos = COALESCE($15, recibe_medicamentos),
        cuales_medicamentos = COALESCE($16, cuales_medicamentos),
        tipo_periodo = COALESCE($17, tipo_periodo),
        especialista_externo = COALESCE($18, especialista_externo),
        externo_fecha_consulta = COALESCE($19, externo_fecha_consulta),
        externo_diagnostico = COALESCE($20, externo_diagnostico),
        externo_tratamiento = COALESCE($21, externo_tratamiento),
        externo_derivado_por = COALESCE($22, externo_derivado_por),
        updated_at = NOW()
      WHERE id_evaluacion = $23
      RETURNING *
    `;
    
    const updateValues = [
      tipo_evaluacion,
      nombre_evaluacion,
      puntuacion_resultado,
      interpretacion,
      observaciones_tecnicas,
      recomendaciones,
      fecha_evaluacion,
      requiere_lenguaje,
      requiere_ocupacional,
      requiere_psicopedagogia,
      requiere_fisico,
      cantidad_sesiones,
      percentil,
      proxima_cita,
      recibe_medicamentos,
      cuales_medicamentos,
      tipo_periodo,
      especialista_externo,
      externo_fecha_consulta,
      externo_diagnostico,
      externo_tratamiento,
      externo_derivado_por,
      id
    ];
    
    const result = await client.query(updateQuery, updateValues);
    
    if (especialistas && Array.isArray(especialistas)) {
      await client.query(
        'UPDATE evaluacion_especialistas SET activo = false WHERE id_evaluacion = $1',
        [id]
      );
      
      for (const esp of especialistas) {
        if (esp.id_especialista) {
          const espCheck = await client.query(
            'SELECT id_especialista, activo FROM especialistas WHERE id_especialista = $1',
            [esp.id_especialista]
          );
          
          if (espCheck.rows.length > 0 && espCheck.rows[0].activo) {
            const pacienteIdResult = await client.query(
              'SELECT id_paciente FROM evaluaciones WHERE id_evaluacion = $1',
              [id]
            );
            const id_paciente = pacienteIdResult.rows[0].id_paciente;
            
            await client.query(
              `INSERT INTO evaluacion_especialistas 
               (id_evaluacion, id_especialista, id_paciente, rol, horas_dedicadas, fecha_asignacion, activo)
               VALUES ($1, $2, $3, $4, $5, NOW(), true)`,
              [id, esp.id_especialista, id_paciente, esp.rol || 'Evaluador', esp.horas_dedicadas || null]
            );
          }
        }
      }
    }
    
    await client.query('COMMIT');
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'actualizar',
      'evaluacion',
      id,
      `Evaluación actualizada: ${id}`,
      getRequestIp(req)
    );
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Evaluación actualizada correctamente' 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al actualizar evaluación:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// ELIMINAR EVALUACIÓN
app.delete('/evaluaciones/:id', async (req, res) => {
  const { id } = req.params;
  const { permanente } = req.query;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    if (permanente === 'true') {
      await client.query('DELETE FROM evaluacion_especialistas WHERE id_evaluacion = $1', [id]);
      const result = await client.query(
        'DELETE FROM evaluaciones WHERE id_evaluacion = $1 RETURNING id_evaluacion',
        [id]
      );
      
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, mensaje: 'Evaluación no encontrada' });
      }
      
      await client.query('COMMIT');
      await registrarAuditoria(
        null,
        null,
        'sistema',
        'eliminar',
        'evaluacion',
        id,
        `Evaluación eliminada permanentemente: ${id}`,
        getRequestIp(req)
      );
      res.status(200).json({ success: true, mensaje: 'Evaluación eliminada permanentemente' });
    } else {
      await client.query(
        'UPDATE evaluacion_especialistas SET activo = false WHERE id_evaluacion = $1',
        [id]
      );
      
      await client.query('COMMIT');
      await registrarAuditoria(
        null,
        null,
        'sistema',
        'inactivar',
        'evaluacion',
        id,
        `Evaluación desactivada correctamente: ${id}`,
        getRequestIp(req)
      );
      res.status(200).json({ success: true, mensaje: 'Evaluación desactivada correctamente' });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al eliminar evaluación:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  } finally {
    client.release();
  }
});

// AGREGAR ESPECIALISTA A EVALUACIÓN EXISTENTE
app.post('/evaluaciones/:id_evaluacion/especialistas', async (req, res) => {
  const { id_evaluacion } = req.params;
  const { id_especialista, rol, horas_dedicadas } = req.body;
  
  if (!id_especialista) {
    return res.status(400).json({ success: false, mensaje: 'ID de especialista es requerido' });
  }
  
  try {
    const evalCheck = await pool.query(
      'SELECT id_evaluacion, id_paciente FROM evaluaciones WHERE id_evaluacion = $1',
      [id_evaluacion]
    );
    
    if (evalCheck.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Evaluación no encontrada' });
    }
    
    const id_paciente = evalCheck.rows[0].id_paciente;
    
    const espCheck = await pool.query(
      'SELECT id_especialista, activo FROM especialistas WHERE id_especialista = $1',
      [id_especialista]
    );
    
    if (espCheck.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista no encontrado' });
    }
    
    if (!espCheck.rows[0].activo) {
      return res.status(400).json({ 
        success: false, 
        mensaje: 'No se puede asignar un especialista inactivo' 
      });
    }
    
    const checkQuery = `
      SELECT id_eval_esp FROM evaluacion_especialistas
      WHERE id_evaluacion = $1 AND id_especialista = $2 AND activo = true
    `;
    const check = await pool.query(checkQuery, [id_evaluacion, id_especialista]);
    
    if (check.rows.length > 0) {
      return res.status(400).json({ 
        success: false, 
        mensaje: 'El especialista ya está asignado a esta evaluación' 
      });
    }
    
    const query = `
      INSERT INTO evaluacion_especialistas   
      (id_evaluacion, id_especialista, id_paciente, rol, horas_dedicadas, fecha_asignacion, activo)
      VALUES ($1, $2, $3, $4, $5, NOW(), true)
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      id_evaluacion,
      id_especialista,
      id_paciente,
      rol || 'Evaluador',
      horas_dedicadas || null
    ]);
    
    res.status(201).json({ 
      success: true, 
      data: result.rows[0],
      mensaje: 'Especialista asignado correctamente'
    });
  } catch (err) {
    console.error('❌ Error al asignar especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER ESPECIALISTAS DE UNA EVALUACIÓN
app.get('/evaluaciones/:id_evaluacion/especialistas', async (req, res) => {
  const { id_evaluacion } = req.params;
  
  try {
    const query = `
      SELECT 
        ee.id_eval_esp,
        ee.id_especialista,
        ee.rol,
        ee.horas_dedicadas,
        ee.fecha_asignacion,
        ee.activo,
        es.nombre_especialista,
        es.especialidad,
        es.cargo,
        es.telefono,
        es.correo
      FROM evaluacion_especialistas ee
      JOIN especialistas es ON ee.id_especialista = es.id_especialista
      WHERE ee.id_evaluacion = $1 AND ee.activo = true
      ORDER BY ee.fecha_asignacion ASC
    `;
    
    const result = await pool.query(query, [id_evaluacion]);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener especialistas de evaluación:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ELIMINAR ESPECIALISTA DE UNA EVALUACIÓN
app.delete('/evaluaciones/:id_evaluacion/especialistas/:id_especialista', async (req, res) => {
  const { id_evaluacion, id_especialista } = req.params;
  
  try {
    const result = await pool.query(
      `UPDATE evaluacion_especialistas 
       SET activo = false 
       WHERE id_evaluacion = $1 AND id_especialista = $2 AND activo = true
       RETURNING id_eval_esp`,
      [id_evaluacion, id_especialista]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        mensaje: 'Relación no encontrada o ya estaba inactiva' 
      });
    }
    
    res.status(200).json({ 
      success: true, 
      mensaje: 'Especialista removido de la evaluación' 
    });
  } catch (err) {
    console.error('❌ Error al remover especialista:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA REPORTES ====================

// OBTENER ESTADÍSTICAS DE PROGRESO (CORREGIDO - nombre correcto de la tabla)
app.get('/reportes/progreso', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id_paciente,
        p.nombre_apellido,
        p.codigo_funauta,
        COALESCE(
          (SELECT puntuacion_resultado FROM evaluaciones 
           WHERE id_paciente = p.id_paciente 
           ORDER BY fecha_evaluacion DESC LIMIT 1), 0
        ) as ultima_evaluacion,
        COUNT(DISTINCT e.id_evaluacion) as total_evaluaciones,
        COUNT(DISTINCT ee.id_especialista) as total_especialistas
      FROM pacientes p
      LEFT JOIN evaluaciones e ON p.id_paciente = e.id_paciente
      LEFT JOIN evaluacion_especialistas ee ON e.id_evaluacion = ee.id_evaluacion AND ee.activo = true
      GROUP BY p.id_paciente, p.nombre_apellido, p.codigo_funauta
    `;
    
    const result = await pool.query(query);
    
    const progreso = result.rows.map(row => {
      let nivel = 'bajo';
      const puntuacion = parseFloat(row.ultima_evaluacion);
      if (puntuacion >= 80) nivel = 'alto';
      else if (puntuacion >= 60) nivel = 'medio';
      
      return {
        id_paciente: row.id_paciente,
        nombre: row.nombre_apellido,
        codigo_funauta: row.codigo_funauta,
        nivel,
        ultimaEvaluacion: puntuacion,
        totalEvaluaciones: parseInt(row.total_evaluaciones) || 0,
        totalEspecialistas: parseInt(row.total_especialistas) || 0
      };
    });
    
    res.status(200).json({ success: true, data: progreso });
  } catch (err) {
    console.error('❌ Error al obtener progreso:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER PACIENTES POR MES (sin cambios, está bien)
app.get('/reportes/pacientes-por-mes', async (req, res) => {
  const { year } = req.query;
  const año = year || new Date().getFullYear();
  
  try {
    const query = `
      SELECT 
        EXTRACT(MONTH FROM fecha_ingreso) as mes,
        COUNT(*) as cantidad
      FROM pacientes
      WHERE EXTRACT(YEAR FROM fecha_ingreso) = $1
      GROUP BY EXTRACT(MONTH FROM fecha_ingreso)
      ORDER BY mes ASC
    `;
    
    const result = await pool.query(query, [año]);
    
    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const datosPorMes = mesesNombres.map((mes, index) => {
      const encontrado = result.rows.find(r => parseInt(r.mes) === index + 1);
      return {
        mes,
        cantidad: encontrado ? parseInt(encontrado.cantidad) : 0,
        year: parseInt(año)
      };
    });
    
    res.status(200).json({ success: true, data: datosPorMes });
  } catch (err) {
    console.error('❌ Error al obtener pacientes por mes:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER CITAS PRÓXIMAS PARA ESPECIALISTA (sin cambios, está bien)
app.get('/especialista/citas-proximas', async (req, res) => {
  const { especialista_id, especialidad } = req.query;
  
  if (!especialista_id && !especialidad) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'Se requiere especialista_id o especialidad' 
    });
  }
  
  try {
    let query = '';
    let values = [];
    
    if (especialista_id) {
      query = `
        SELECT DISTINCT
          c.id_cita,
          c.fecha_cita,
          c.hora_cita,
          c.tipo_cita,
          c.estado,
          c.observaciones,
          p.id_paciente,
          p.nombre_apellido as paciente_nombre,
          p.activo as paciente_activo,
          p.codigo_funauta,
          p.diagnostico_tea
        FROM citas c
        JOIN pacientes p ON c.id_paciente = p.id_paciente
        WHERE c.id_especialista = $1
          AND c.estado = 'pendiente'
          AND c.fecha_cita >= CURRENT_DATE
          AND c.fecha_cita <= CURRENT_DATE + INTERVAL '7 days'
          AND p.activo = true
        ORDER BY c.fecha_cita ASC, c.hora_cita ASC
      `;
      values = [especialista_id];
    } else {
      let campoDerivacion = '';
      switch (especialidad) {
        case 'lenguaje': campoDerivacion = 'requiere_lenguaje'; break;
        case 'ocupacional': campoDerivacion = 'requiere_ocupacional'; break;
        case 'psicopedagogia': campoDerivacion = 'requiere_psicopedagogia'; break;
        case 'fisioterapia': campoDerivacion = 'requiere_fisico'; break;
        default: campoDerivacion = 'requiere_lenguaje';
      }
      
      query = `
        SELECT DISTINCT
          e.id_evaluacion,
          e.proxima_cita as fecha_cita,
          p.id_paciente,
          p.nombre_apellido as paciente_nombre,
          p.activo as paciente_activo,
          p.codigo_funauta,
          e.nombre_evaluacion,
          e.recomendaciones,
          e.tipo_evaluacion
        FROM evaluaciones e
        JOIN pacientes p ON e.id_paciente = p.id_paciente
        WHERE e.${campoDerivacion} = true
          AND e.proxima_cita IS NOT NULL
          AND e.proxima_cita >= CURRENT_DATE
          AND e.proxima_cita <= CURRENT_DATE + INTERVAL '7 days'
          AND p.activo = true
        ORDER BY e.proxima_cita ASC
      `;
      values = [];
    }
    
    const result = await pool.query(query, values);
    
    res.status(200).json({ 
      success: true, 
      data: result.rows,
      count: result.rows.length 
    });
  } catch (err) {
    console.error('❌ Error al obtener citas próximas:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER ESTADÍSTICAS DE CITAS (sin cambios, está bien)
app.get('/citas/estadisticas/resumen', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) as total FROM citas');
    const pendientes = await pool.query('SELECT COUNT(*) as pendientes FROM citas WHERE estado = $1', ['pendiente']);
    const realizadas = await pool.query('SELECT COUNT(*) as realizadas FROM citas WHERE estado = $1', ['realizada']);
    const canceladas = await pool.query('SELECT COUNT(*) as canceladas FROM citas WHERE estado = $1', ['cancelada']);
    
    const hoy = new Date().toISOString().split('T')[0];
    const citasHoy = await pool.query('SELECT COUNT(*) as hoy FROM citas WHERE fecha_cita = $1', [hoy]);
    
    res.json({
      success: true,
      data: {
        total: parseInt(total.rows[0].total),
        pendientes: parseInt(pendientes.rows[0].pendientes),
        realizadas: parseInt(realizadas.rows[0].realizadas),
        canceladas: parseInt(canceladas.rows[0].canceladas),
        hoy: parseInt(citasHoy.rows[0].hoy)
      }
    });
  } catch (err) {
    console.error('❌ Error al obtener estadísticas de citas:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ESTADÍSTICAS COMPLETAS PARA EL DASHBOARD (sin cambios, está bien)
app.get('/dashboard/estadisticas', async (req, res) => {
  try {
    const totalPacientes = await pool.query('SELECT COUNT(*) as total FROM pacientes');
    const pacientesActivos = await pool.query('SELECT COUNT(*) as activos FROM pacientes WHERE activo = true');
    const pacientesConTEA = await pool.query('SELECT COUNT(*) as con_tea FROM pacientes WHERE diagnostico_tea = true');
    
    const totalEspecialistas = await pool.query('SELECT COUNT(*) as total FROM especialistas WHERE activo = true');
    
    const citasHoy = await pool.query(`
      SELECT COUNT(*) as hoy FROM citas 
      WHERE fecha_cita = CURRENT_DATE AND estado = 'pendiente'
    `);
    const citasSemana = await pool.query(`
      SELECT COUNT(*) as semana FROM citas 
      WHERE fecha_cita >= CURRENT_DATE 
        AND fecha_cita <= CURRENT_DATE + INTERVAL '7 days'
        AND estado = 'pendiente'
    `);
    
    const evaluacionesMes = await pool.query(`
      SELECT COUNT(*) as evaluaciones FROM evaluaciones 
      WHERE EXTRACT(MONTH FROM fecha_evaluacion) = EXTRACT(MONTH FROM CURRENT_DATE)
    `);
    
    const ingresosMes = await pool.query(`
      SELECT COALESCE(SUM(monto_o_valor), 0) as ingresos 
      FROM gestion_administrativa 
      WHERE naturaleza = 'INGRESO' 
        AND EXTRACT(MONTH FROM fecha_registro) = EXTRACT(MONTH FROM CURRENT_DATE)
    `);
    const egresosMes = await pool.query(`
      SELECT COALESCE(SUM(monto_o_valor), 0) as egresos 
      FROM gestion_administrativa 
      WHERE naturaleza = 'EGRESO' 
        AND EXTRACT(MONTH FROM fecha_registro) = EXTRACT(MONTH FROM CURRENT_DATE)
    `);
    
    res.status(200).json({
      success: true,
      data: {
        pacientes: {
          total: parseInt(totalPacientes.rows[0].total),
          activos: parseInt(pacientesActivos.rows[0].activos),
          conTEA: parseInt(pacientesConTEA.rows[0].con_tea)
        },
        especialistas: {
          total: parseInt(totalEspecialistas.rows[0].total)
        },
        citas: {
          hoy: parseInt(citasHoy.rows[0].hoy),
          semana: parseInt(citasSemana.rows[0].semana)
        },
        evaluaciones: {
          mes: parseInt(evaluacionesMes.rows[0].evaluaciones)
        },
        finanzas: {
          ingresosMes: parseFloat(ingresosMes.rows[0].ingresos),
          egresosMes: parseFloat(egresosMes.rows[0].egresos),
          netoMes: parseFloat(ingresosMes.rows[0].ingresos) - parseFloat(egresosMes.rows[0].egresos)
        }
      }
    });
  } catch (err) {
    console.error('❌ Error al obtener estadísticas del dashboard:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA GESTIÓN ADMINISTRATIVA ====================

// OBTENER TODOS LOS REGISTROS DE GESTIÓN
app.get('/gestiones', async (req, res) => {
  const { fecha_inicio, fecha_fin, naturaleza, categoria } = req.query;
  
  try {
    let query = `
      SELECT 
        g.id_gestion,
        g.dato_a_recolectar as concepto,
        g.categoria,
        g.naturaleza as tipo,
        g.frecuencia,
        g.monto_o_valor as monto,
        g.fuente_ingreso,
        g.responsable,
        g.fecha_registro as fecha,
        g.id_moneda,
        COALESCE(m.simbolo, 'Bs.') as moneda_simbolo,
        COALESCE(m.nombre, 'Bolívares') as moneda_nombre
      FROM gestion_administrativa g
      LEFT JOIN monedas m ON g.id_moneda = m.id_moneda
      WHERE 1=1
    `;
    
    let values = [];
    let idx = 1;
    
    if (fecha_inicio) {
      query += ` AND g.fecha_registro >= $${idx++}`;
      values.push(fecha_inicio);
    }
    
    if (fecha_fin) {
      query += ` AND g.fecha_registro <= $${idx++}`;
      values.push(fecha_fin);
    }
    
    if (naturaleza) {
      query += ` AND g.naturaleza = $${idx++}`;
      values.push(naturaleza);
    }
    
    if (categoria) {
      query += ` AND g.categoria = $${idx++}`;
      values.push(categoria);
    }
    
    query += ` ORDER BY g.fecha_registro DESC, g.id_gestion DESC`;
    
    const result = await pool.query(query, values);
    
    let totalIngresos = 0;
    let totalEgresos = 0;
    const balancePorMoneda = {
      'Bolívares': { ingresos: 0, egresos: 0, neto: 0, simbolo: 'Bs.' },
      'Dólares': { ingresos: 0, egresos: 0, neto: 0, simbolo: '$' },
      'Pesos': { ingresos: 0, egresos: 0, neto: 0, simbolo: 'COP$' }
    };
    
    result.rows.forEach(row => {
      const monto = parseFloat(row.monto);
      const monedaNombre = row.moneda_nombre;
      
      if (row.tipo === 'INGRESO') {
        totalIngresos += monto;
        if (balancePorMoneda[monedaNombre]) {
          balancePorMoneda[monedaNombre].ingresos += monto;
        }
      } else if (row.tipo === 'EGRESO') {
        totalEgresos += monto;
        if (balancePorMoneda[monedaNombre]) {
          balancePorMoneda[monedaNombre].egresos += monto;
        }
      }
    });
    
    Object.keys(balancePorMoneda).forEach(moneda => {
      balancePorMoneda[moneda].neto = balancePorMoneda[moneda].ingresos - balancePorMoneda[moneda].egresos;
    });
    
    res.status(200).json({ 
      success: true, 
      data: result.rows,
      balance: {
        ingresos: totalIngresos,
        egresos: totalEgresos,
        neto: totalIngresos - totalEgresos,
        porMoneda: balancePorMoneda
      }
    });
  } catch (err) {
    console.error('❌ Error al obtener gestiones:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// REGISTRAR NUEVO MOVIMIENTO
app.post('/gestiones', async (req, res) => {
  const {
    dato_a_recolectar,
    categoria,
    naturaleza,
    frecuencia,
    monto_o_valor,
    fuente_ingreso,
    responsable,
    fecha_registro,
    id_moneda,
    id_usuario_admin
  } = req.body;
  
  const errores = [];
  if (!dato_a_recolectar || dato_a_recolectar.trim() === '') {
    errores.push('El concepto es requerido');
  }
  if (!naturaleza) {
    errores.push('La naturaleza (ingreso/egreso) es requerida');
  }
  if (!monto_o_valor || isNaN(parseFloat(monto_o_valor)) || parseFloat(monto_o_valor) <= 0) {
    errores.push('El monto debe ser un número mayor a 0');
  }
  
  if (errores.length > 0) {
    return res.status(400).json({ 
      success: false, 
      mensaje: 'Por favor corrija los siguientes errores:',
      errores: errores
    });
  }
  
  try {
    const query = `
      INSERT INTO gestion_administrativa (
        dato_a_recolectar,
        categoria,
        naturaleza,
        frecuencia,
        monto_o_valor,
        fuente_ingreso,
        responsable,
        fecha_registro,
        id_moneda,
        id_usuario_admin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      dato_a_recolectar.trim(),
      categoria || null,
      naturaleza,
      frecuencia || null,
      parseFloat(monto_o_valor),
      fuente_ingreso || null,
      responsable || null,
      fecha_registro || new Date().toISOString().split('T')[0],
      id_moneda || 1,
      id_usuario_admin || null
    ]);
    
    console.log('✅ Registro creado con ID:', result.rows[0].id_gestion);
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: `${naturaleza === 'INGRESO' ? 'Ingreso' : 'Egreso'} registrado correctamente` 
    });
  } catch (err) {
    console.error('❌ Error al registrar:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ACTUALIZAR MOVIMIENTO
app.put('/gestiones/:id', async (req, res) => {
  const { id } = req.params;
  const {
    dato_a_recolectar,
    categoria,
    naturaleza,
    frecuencia,
    monto_o_valor,
    fuente_ingreso,
    responsable,
    fecha_registro,
    id_moneda
  } = req.body;
  
  try {
    const existingRecord = await pool.query(
      'SELECT id_gestion FROM gestion_administrativa WHERE id_gestion = $1',
      [id]
    );
    
    if (existingRecord.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
    }
    
    const query = `
      UPDATE gestion_administrativa 
      SET 
        dato_a_recolectar = COALESCE($1, dato_a_recolectar),
        categoria = COALESCE($2, categoria),
        naturaleza = COALESCE($3, naturaleza),
        frecuencia = COALESCE($4, frecuencia),
        monto_o_valor = COALESCE($5, monto_o_valor),
        fuente_ingreso = COALESCE($6, fuente_ingreso),
        responsable = COALESCE($7, responsable),
        fecha_registro = COALESCE($8, fecha_registro),
        id_moneda = COALESCE($9, id_moneda),
        updated_at = CURRENT_TIMESTAMP
      WHERE id_gestion = $10
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      dato_a_recolectar,
      categoria,
      naturaleza,
      frecuencia,
      monto_o_valor ? parseFloat(monto_o_valor) : null,
      fuente_ingreso,
      responsable,
      fecha_registro,
      id_moneda,
      id
    ]);
    
    res.status(200).json({ 
      success: true, 
      data: result.rows[0], 
      mensaje: 'Registro actualizado correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al actualizar:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ELIMINAR MOVIMIENTO
app.delete('/gestiones/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM gestion_administrativa WHERE id_gestion = $1 RETURNING id_gestion',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Registro no encontrado' });
    }
    
    res.status(200).json({ 
      success: true, 
      mensaje: 'Registro eliminado correctamente' 
    });
  } catch (err) {
    console.error('❌ Error al eliminar:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER CATEGORÍAS ÚNICAS
app.get('/gestiones-categorias', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT categoria FROM gestion_administrativa 
      WHERE categoria IS NOT NULL AND categoria != ''
      ORDER BY categoria ASC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener categorías:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER ESTADÍSTICAS DE GESTIÓN
app.get('/gestiones/estadisticas/resumen', async (req, res) => {
  try {
    const totalIngresos = await pool.query(
      "SELECT COALESCE(SUM(monto_o_valor), 0) as total FROM gestion_administrativa WHERE naturaleza = 'INGRESO'"
    );
    const totalEgresos = await pool.query(
      "SELECT COALESCE(SUM(monto_o_valor), 0) as total FROM gestion_administrativa WHERE naturaleza = 'EGRESO'"
    );
    
    res.json({
      success: true,
      data: {
        totalIngresos: parseFloat(totalIngresos.rows[0].total),
        totalEgresos: parseFloat(totalEgresos.rows[0].total),
        neto: parseFloat(totalIngresos.rows[0].total) - parseFloat(totalEgresos.rows[0].total)
      }
    });
  } catch (err) {
    console.error('❌ Error al obtener estadísticas:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTA DE VERIFICACIÓN ====================

app.get('/', (req, res) => {
  res.json({ 
    message: 'Servidor Funauta funcionando correctamente',
    version: '1.0.0',
    endpoints: {
      pacientes: '/pacientes',
      especialistas: '/especialistas',
      citas: '/citas',
      padres: '/padres',
      evaluaciones: '/evaluaciones',
      reportes: '/reportes/progreso',
      login: '/login'
    }
  });
});

// ==================== RUTAS PARA ESPECIALISTAS EXTERNOS ====================

// OBTENER TODOS LOS ESPECIALISTAS EXTERNOS
app.get('/especialistas-externos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM especialistas_externos 
      ORDER BY nombre_completo ASC
    `);
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener especialistas externos:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// OBTENER UN ESPECIALISTA EXTERNO POR ID
app.get('/especialistas-externos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT * FROM especialistas_externos WHERE id_esp_externo = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista externo no encontrado' });
    }
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error al obtener especialista externo:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// REGISTRAR NUEVO ESPECIALISTA EXTERNO
app.post('/especialistas-externos', async (req, res) => {
  const { nombre_completo, especialidad, institucion, telefono, correo, direccion, registro_profesional } = req.body;
  
  if (!nombre_completo) {
    return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO especialistas_externos 
      (nombre_completo, especialidad, institucion, telefono, correo, direccion, registro_profesional)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [nombre_completo, especialidad, institucion, telefono, correo, direccion, registro_profesional]);
    
    res.status(201).json({ success: true, data: result.rows[0], mensaje: 'Especialista externo registrado' });
  } catch (err) {
    console.error('❌ Error al registrar especialista externo:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ACTUALIZAR ESPECIALISTA EXTERNO
app.put('/especialistas-externos/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre_completo, especialidad, institucion, telefono, correo, direccion, registro_profesional } = req.body;
  
  try {
    const result = await pool.query(`
      UPDATE especialistas_externos 
      SET 
        nombre_completo = COALESCE($1, nombre_completo),
        especialidad = COALESCE($2, especialidad),
        institucion = COALESCE($3, institucion),
        telefono = COALESCE($4, telefono),
        correo = COALESCE($5, correo),
        direccion = COALESCE($6, direccion),
        registro_profesional = COALESCE($7, registro_profesional),
        updated_at = NOW()
      WHERE id_esp_externo = $8
      RETURNING *
    `, [nombre_completo, especialidad, institucion, telefono, correo, direccion, registro_profesional, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista externo no encontrado' });
    }
    res.status(200).json({ success: true, data: result.rows[0], mensaje: 'Actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error al actualizar especialista externo:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ELIMINAR ESPECIALISTA EXTERNO
app.delete('/especialistas-externos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      DELETE FROM especialistas_externos WHERE id_esp_externo = $1 RETURNING id_esp_externo
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Especialista externo no encontrado' });
    }
    res.status(200).json({ success: true, mensaje: 'Eliminado correctamente' });
  } catch (err) {
    console.error('❌ Error al eliminar especialista externo:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA PLANES DE INTERVENCIÓN ====================

// OBTENER PLANES DE UN PACIENTE
app.get('/pacientes/:id/planes', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT * FROM planes_intervencion 
      WHERE id_paciente = $1 
      ORDER BY fecha_inicio DESC
    `, [id]);
    
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener planes:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// CREAR NUEVO PLAN DE INTERVENCIÓN
app.post('/planes', async (req, res) => {
  const {
    id_paciente,
    fecha_inicio,
    fecha_fin,
    deseo_capacitacion_padre,
    nombre_institucion,
    estado_plan,
    objetivo_plan,
    frecuencia,
    tipo_institucion
  } = req.body;
  
  if (!id_paciente) {
    return res.status(400).json({ success: false, mensaje: 'ID de paciente es requerido' });
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO planes_intervencion (
        id_paciente, fecha_inicio, fecha_fin, deseo_capacitacion_padre,
        nombre_institucion, estado_plan, objetivo_plan, frecuencia, tipo_institucion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      id_paciente, fecha_inicio || new Date().toISOString().split('T')[0],
      fecha_fin || null, deseo_capacitacion_padre || false,
      nombre_institucion || null, estado_plan || 'activo',
      objetivo_plan || null, frecuencia || 'semanal',
      tipo_institucion || null
    ]);
    
    res.status(201).json({ success: true, data: result.rows[0], mensaje: 'Plan creado correctamente' });
  } catch (err) {
    console.error('❌ Error al crear plan:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ACTUALIZAR PLAN
app.put('/planes/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  try {
    const setClause = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`).join(', ');
    const values = [...Object.values(updates), id];
    
    const result = await pool.query(`
      UPDATE planes_intervencion SET ${setClause} WHERE id_plan = $${values.length} RETURNING *
    `, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Plan no encontrado' });
    }
    
    res.status(200).json({ success: true, data: result.rows[0], mensaje: 'Plan actualizado' });
  } catch (err) {
    console.error('❌ Error al actualizar plan:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA TALLERES E INSTRUMENTOS ====================

// OBTENER TALLERES DE UN PACIENTE
app.get('/pacientes/:id/talleres', async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT t.*, e.nombre_especialista 
      FROM talleres_instrumentos t
      LEFT JOIN especialistas e ON t.id_especialista = e.id_especialista
      WHERE t.id_paciente = $1 
      ORDER BY t.fecha_taller DESC
    `, [id]);
    
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error al obtener talleres:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// REGISTRAR NUEVO TALLER
app.post('/talleres', async (req, res) => {
  const {
    fecha_taller,
    id_especialista,
    id_paciente,
    categoria,
    herramienta_utilizada,
    avance_integral,
    nombre_taller,
    url_recurso_pdf
  } = req.body;
  
  if (!id_paciente) {
    return res.status(400).json({ success: false, mensaje: 'ID de paciente es requerido' });
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO talleres_instrumentos (
        fecha_taller, id_especialista, id_paciente, categoria,
        herramienta_utilizada, avance_integral, nombre_taller, url_recurso_pdf
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      fecha_taller || new Date().toISOString().split('T')[0],
      id_especialista || null,
      id_paciente,
      categoria || 'taller',
      herramienta_utilizada || null,
      avance_integral || null,
      nombre_taller,
      url_recurso_pdf || null
    ]);
    await registrarAuditoria(
      null,
      null,
      'sistema',
      'crear',
      'taller',
      result.rows[0].id_taller,
      `Taller registrado para paciente ${id_paciente}`,
      getRequestIp(req)
    );
    
    res.status(201).json({ success: true, data: result.rows[0], mensaje: 'Taller registrado correctamente' });
  } catch (err) {
    console.error('❌ Error al registrar taller:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ==================== RUTAS PARA USUARIOS ====================

// ==================== RUTAS PARA USUARIOS ====================

// ACTUALIZAR CORREO DE USUARIO
app.put('/usuarios/:id/correo', async (req, res) => {
    const { id } = req.params;
    const { correo } = req.body;
    
    if (!correo || !correo.includes('@')) {
        return res.status(400).json({ success: false, mensaje: 'Correo electrónico inválido' });
    }
    
    try {
        const existingUser = await pool.query(
            'SELECT id_usuario FROM usuarios WHERE correo = $1 AND id_usuario != $2',
            [correo, id]
        );
        
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, mensaje: 'El correo ya está registrado por otro usuario' });
        }
        
        await pool.query(
            'UPDATE usuarios SET correo = $1 WHERE id_usuario = $2',
            [correo, id]
        );
        
        const especialistaResult = await pool.query(
            'SELECT id_especialista FROM especialistas WHERE id_usuario = $1',
            [id]
        );
        
        if (especialistaResult.rows.length > 0) {
            await pool.query(
                'UPDATE especialistas SET correo = $1 WHERE id_usuario = $2',
                [correo, id]
            );
        }
        
        const padreResult = await pool.query(
            'SELECT id_padre FROM padres WHERE id_usuario = $1',
            [id]
        );
        
        if (padreResult.rows.length > 0) {
            await pool.query(
                'UPDATE padres SET correo = $1 WHERE id_usuario = $2',
                [correo, id]
            );
        }
        
        await registrarAuditoria(
            id,
            correo,
            'usuario',
            'actualizar',
            'usuario',
            id,
            `Correo de usuario actualizado: ${correo}`,
            getRequestIp(req)
        );
        
        console.log(`✅ Correo actualizado para usuario ID ${id}: ${correo}`);
        res.status(200).json({ success: true, mensaje: 'Correo actualizado correctamente' });
        
    } catch (err) {
        console.error('❌ Error al actualizar correo:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// CAMBIAR CONTRASEÑA DE USUARIO
app.put('/usuarios/:id/password', async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    
    if (!password || password.length < 3) {
        return res.status(400).json({ 
            success: false, 
            mensaje: 'La contraseña debe tener al menos 3 caracteres' 
        });
    }
    
    try {
        const result = await pool.query(
            'UPDATE usuarios SET password = $1 WHERE id_usuario = $2 RETURNING id_usuario, correo',
            [password, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
        }
        
        await registrarAuditoria(
            result.rows[0].id_usuario,
            result.rows[0].correo,
            'usuario',
            'actualizar',
            'usuario',
            result.rows[0].id_usuario,
            `Contraseña de usuario actualizada`,
            getRequestIp(req)
        );
        
        console.log(`✅ Contraseña actualizada para usuario: ${result.rows[0].correo}`);
        
        res.status(200).json({ 
            success: true, 
            mensaje: 'Contraseña actualizada correctamente' 
        });
    } catch (err) {
        console.error('❌ Error al cambiar contraseña:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// OBTENER TODOS LOS USUARIOS (para admin)
app.get('/usuarios', async (req, res) => {
    try {
        const query = `
            SELECT u.id_usuario, u.correo, u.activo, r.nombre as rol
            FROM usuarios u
            LEFT JOIN roles r ON u.id_rol = r.id_rol
            ORDER BY u.id_usuario ASC
        `;
        
        const result = await pool.query(query);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error('❌ Error al obtener usuarios:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// OBTENER UN USUARIO POR ID
app.get('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const query = `
            SELECT u.id_usuario, u.correo, u.activo, r.nombre as rol
            FROM usuarios u
            LEFT JOIN roles r ON u.id_rol = r.id_rol
            WHERE u.id_usuario = $1
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
        }
        
        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error('❌ Error al obtener usuario:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// CREAR NUEVO USUARIO
app.post('/usuarios', async (req, res) => {
    const { correo, password, rol } = req.body;
    
    if (!correo || !password || !rol) {
        return res.status(400).json({ success: false, mensaje: 'Correo, contraseña y rol son requeridos' });
    }
    
    try {
        // Verificar si el correo ya existe
        const existingUser = await pool.query(
            'SELECT id_usuario FROM usuarios WHERE correo = $1',
            [correo]
        );
        
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ success: false, mensaje: 'El correo ya está registrado' });
        }
        
        // Obtener ID del rol
        const rolResult = await pool.query(
            'SELECT id_rol FROM roles WHERE nombre = $1',
            [rol]
        );
        
        if (rolResult.rows.length === 0) {
            return res.status(400).json({ success: false, mensaje: 'Rol no válido' });
        }
        
        const id_rol = rolResult.rows[0].id_rol;
        
        const result = await pool.query(
            `INSERT INTO usuarios (correo, password, id_rol, activo, created_at, updated_at) 
             VALUES ($1, $2, $3, true, NOW(), NOW()) 
             RETURNING id_usuario, correo, id_rol`,
            [correo, password, id_rol]
        );
        
        console.log(`✅ Usuario creado: ${correo} (ID: ${result.rows[0].id_usuario})`);
        await registrarAuditoria(
            null,
            correo,
            rol,
            'crear',
            'usuario',
            result.rows[0].id_usuario,
            `Usuario creado: ${correo} rol ${rol}`,
            getRequestIp(req)
        );
        res.status(200).json({ success: true, data: result.rows[0], mensaje: 'Usuario creado correctamente' });
        
    } catch (err) {
        console.error('❌ Error al crear usuario:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// ACTIVAR/DESACTIVAR USUARIO
app.put('/usuarios/:id/activar', async (req, res) => {
    const { id } = req.params;
    const { activo } = req.body;
    
    try {
        const result = await pool.query(
            'UPDATE usuarios SET activo = $1, updated_at = NOW() WHERE id_usuario = $2 RETURNING id_usuario, correo, activo',
            [activo, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
        }
        
        const mensaje = activo ? 'Usuario activado' : 'Usuario desactivado';
        console.log(`✅ ${mensaje}: ${result.rows[0].correo}`);
        await registrarAuditoria(
            result.rows[0].id_usuario,
            result.rows[0].correo,
            'usuario',
            activo ? 'activar' : 'inactivar',
            'usuario',
            result.rows[0].id_usuario,
            `${mensaje} correctamente`,
            getRequestIp(req)
        );
        
        res.status(200).json({ 
            success: true, 
            mensaje: `${mensaje} correctamente` 
        });
    } catch (err) {
        console.error('❌ Error al activar/desactivar usuario:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// ELIMINAR USUARIO (inactivar)
app.delete('/usuarios/:id', async (req, res) => {
    const { id } = req.params;
    const { permanente } = req.query;
    
    try {
        const userResult = await pool.query(
            'SELECT correo FROM usuarios WHERE id_usuario = $1',
            [id]
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
        }

        const userCorreo = userResult.rows[0].correo;

        if (permanente === 'true') {
            await pool.query('DELETE FROM usuarios WHERE id_usuario = $1', [id]);
            await registrarAuditoria(
                id,
                userCorreo,
                'usuario',
                'eliminar',
                'usuario',
                id,
                `Usuario eliminado permanentemente`,
                getRequestIp(req)
            );
            res.status(200).json({ success: true, mensaje: 'Usuario eliminado permanentemente' });
        } else {
            await pool.query('UPDATE usuarios SET activo = false, updated_at = NOW() WHERE id_usuario = $1', [id]);
            await registrarAuditoria(
                id,
                userCorreo,
                'usuario',
                'inactivar',
                'usuario',
                id,
                `Usuario inactivado correctamente`,
                getRequestIp(req)
            );
            res.status(200).json({ success: true, mensaje: 'Usuario inactivado correctamente' });
        }
    } catch (err) {
        console.error('❌ Error al eliminar/inactivar usuario:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// ==================== RUTAS PARA CONFIGURACIÓN DE LA APP ====================

// OBTENER CONFIGURACIÓN
app.get('/configuracion', async (req, res) => {
    try {
        // Verificar si la tabla configuracion existe
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'configuracion'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            // Si la tabla no existe, devolver configuración por defecto
            return res.status(200).json({ 
                success: true, 
                data: {
                    app_titulo: 'Fundación Funauta',
                    app_lema: '"El Autismo es parte de este mundo, no un mundo aparte"',
                    app_descripcion: 'Somos una fundación dedicada a apoyar el desarrollo integral de niños y adolescentes...',
                    app_logo_url: null
                } 
            });
        }
        
        const result = await pool.query('SELECT clave, valor, tipo FROM configuracion');
        const config = {};
        result.rows.forEach(row => {
            config[row.clave] = row.valor;
        });
        
        // Mapear a los nombres esperados por el frontend
        const responseData = {
            app_titulo: config.app_titulo || 'Fundación Funauta',
            app_lema: config.app_lema || '"El Autismo es parte de este mundo, no un mundo aparte"',
            app_descripcion: config.app_descripcion || 'Somos una fundación dedicada a apoyar el desarrollo integral...',
            app_logo_url: config.app_logo_url || null
        };
        
        res.status(200).json({ success: true, data: responseData });
    } catch (err) {
        console.error('❌ Error al obtener configuración:', err.message);
        // En caso de error, devolver valores por defecto
        res.status(200).json({ 
            success: true, 
            data: {
                app_titulo: 'Fundación Funauta',
                app_lema: '"El Autismo es parte de este mundo, no un mundo aparte"',
                app_descripcion: 'Somos una fundación dedicada a apoyar el desarrollo integral...',
                app_logo_url: null
            } 
        });
    }
});

// ACTUALIZAR CONFIGURACIÓN
app.put('/configuracion', async (req, res) => {
    const { config } = req.body;
    
    if (!config || typeof config !== 'object') {
        return res.status(400).json({ success: false, mensaje: 'Datos de configuración inválidos' });
    }
    
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        for (const [clave, valor] of Object.entries(config)) {
            await client.query(
                `INSERT INTO configuracion (clave, valor, tipo, updated_at) 
                 VALUES ($1, $2, 'texto', NOW()) 
                 ON CONFLICT (clave) 
                 DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
                [clave, valor]
            );
        }
        
        await client.query('COMMIT');
        
        console.log('✅ Configuración actualizada correctamente');
        res.status(200).json({ success: true, mensaje: 'Configuración guardada correctamente' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error al actualizar configuración:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    } finally {
        client.release();
    }
});

// Configurar multer para logos
const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads', 'logos');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `logo-${Date.now()}${ext}`);
    }
});

const uploadLogo = multer({ 
    storage: logoStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes'));
        }
    }
});

// RUTA PARA SUBIR LOGO
app.post('/configuracion/logo', uploadLogo.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, mensaje: 'No se recibió ninguna imagen' });
        }
        
        const logoUrl = `/uploads/logos/${req.file.filename}`;
        
        await pool.query(
            `INSERT INTO configuracion (clave, valor, tipo, updated_at) 
             VALUES ('app_logo_url', $1, 'imagen', NOW()) 
             ON CONFLICT (clave) 
             DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
            [logoUrl]
        );
        
        res.status(200).json({ success: true, logoUrl, mensaje: 'Logo actualizado correctamente' });
    } catch (err) {
        console.error('❌ Error al subir logo:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});

// ==================== RUTAS DE AUDITORÍA ====================

// OBTENER REGISTROS DE AUDITORÍA (con filtros y paginación)
app.get('/auditoria', async (req, res) => {
    try {
        const { 
            entidad, 
            accion, 
            usuario, 
            fecha_desde, 
            fecha_hasta, 
            pagina = 1, 
            limite = 20 
        } = req.query;
        
        const offset = (parseInt(pagina) - 1) * parseInt(limite);
        let values = [];
        let conditions = [];
        let idx = 1;
        
        let query = `
            SELECT 
                a.id_auditoria as id,
                a.usuario_correo,
                a.usuario_rol,
                a.accion,
                a.entidad,
                a.entidad_id,
                a.detalles,
                a.ip,
                a.fecha
            FROM auditoria a
            WHERE 1=1
        `;
        
        if (entidad) {
            conditions.push(`a.entidad = $${idx++}`);
            values.push(entidad);
        }
        
        if (accion) {
            conditions.push(`a.accion = $${idx++}`);
            values.push(accion);
        }
        
        if (usuario) {
            conditions.push(`a.usuario_correo ILIKE $${idx++}`);
            values.push(`%${usuario}%`);
        }
        
        if (fecha_desde) {
            conditions.push(`a.fecha >= $${idx++}`);
            values.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            conditions.push(`a.fecha <= $${idx++} || ' 23:59:59'`);
            values.push(fecha_hasta);
        }
        
        if (conditions.length > 0) {
            query += ` AND ${conditions.join(' AND ')}`;
        }
        
        // Consulta para contar total
        const countQuery = query.replace(
            /SELECT[\s\S]*?FROM/,
            'SELECT COUNT(*) as total FROM'
        );
        
        const countResult = await pool.query(countQuery, values);
        const total = parseInt(countResult.rows[0].total);
        const totalPaginas = Math.ceil(total / parseInt(limite));
        
        // Consulta con paginación
        query += ` ORDER BY a.fecha DESC LIMIT $${idx++} OFFSET $${idx++}`;
        values.push(parseInt(limite), offset);
        
        const result = await pool.query(query, values);
        
        res.status(200).json({
            success: true,
            data: result.rows,
            total: total,
            pagina: parseInt(pagina),
            total_paginas: totalPaginas,
            limite: parseInt(limite)
        });
    } catch (err) {
        console.error('❌ Error al obtener auditoría:', err.message);
        res.status(500).json({ success: false, mensaje: err.message });
    }
});


// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log("========================================");
  console.log("🚀 Servidor Funauta corriendo");
  console.log("========================================");
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  console.log(`📱 Red local: http://192.168.1.34:${PORT}`);
  console.log("========================================");
});