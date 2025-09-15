const express = require('express');
const session = require('express-session');
const path = require('path');
const PropinaDatabase = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de sesiones
app.use(session({
  secret: 'cafe123-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Inicializar base de datos
const db = new PropinaDatabase();
db.init();

// Middleware de autenticación
const checkAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
};

// Función de ayuda para formatear fechas sin problemas de zona horaria
const formatearFecha = (fechaString, opcion) => {
  // Extraer año, mes y día del string (formato YYYY-MM-DD)
  const [year, month, day] = fechaString.split('-').map(num => parseInt(num, 10));
  
  // Crear un objeto para mapear los días de la semana
  const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  
  // Crear un objeto para los nombres de los meses
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  
  // Para obtener el día de la semana correctamente, creamos una fecha con tiempo al mediodía
  const fecha = new Date(year, month - 1, day, 12, 0, 0);
  
  if (opcion === 'diaSemana') {
    return diasSemana[fecha.getDay()];
  } else if (opcion === 'completa') {
    return `${day} de ${meses[month - 1]} de ${year}`;
  } else if (opcion === 'corta') {
    return `${day}/${month}/${year}`;
  } else if (opcion === 'diaDelMes') {
    return `${day}`;
  } else if (opcion === 'mes') {
    return meses[month - 1];
  } else if (opcion === 'año') {
    return `${year}`;
  } else {
    return fechaString;
  }
};

// Middleware para añadir la función de formateo a todas las vistas
app.use((req, res, next) => {
  res.locals.formatearFecha = formatearFecha;
  next();
});

// Rutas
app.get('/', async (req, res) => {
  // Redirigir a la vista de empleados
  res.redirect('/empleados');
});

app.get('/login', (req, res) => {
  res.render('login', { redirectTo: req.query.redirect || '/admin' });
});

app.post('/login', (req, res) => {
  if (req.body.password === 'cafe123') {
    req.session.authenticated = true;
    const redirectTo = req.body.redirectTo || '/admin';
    res.redirect(redirectTo);
  } else {
    const redirectTo = req.body.redirectTo || '/admin';
    res.render('login', { error: 'Contraseña incorrecta', redirectTo });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.get('/main', async (req, res) => {
  try {
    const empleados = await db.getEmpleados();
    
    // Determinar la fecha de inicio de semana
    let inicioSemana;
    if (req.query.semana) {
      // Crear una fecha al mediodía para evitar problemas de timezone
      const [year, month, day] = req.query.semana.split('-').map(num => parseInt(num, 10));
      inicioSemana = new Date(year, month - 1, day, 12, 0, 0);
      
      if (isNaN(inicioSemana.getTime())) {
        throw new Error('Fecha inválida');
      }
    } else {
      // Obtener el lunes de la semana actual a las 12 del mediodía
      const fechaActual = new Date();
      // Ajustar a mediodía
      fechaActual.setHours(12, 0, 0, 0);
      // Obtener el lunes (día 1 de la semana)
      inicioSemana = new Date(fechaActual);
      inicioSemana.setDate(fechaActual.getDate() - fechaActual.getDay() + 1);
    }
    
    const propinas = await db.getPropinasSemana(inicioSemana);
    
    res.render('main', { 
      empleados, 
      propinas, 
      semana: inicioSemana,
      esAdmin: req.query.admin === 'true'
    });
  } catch (error) {
    console.error('Error en ruta /main:', error);
    res.render('main', { 
      error: 'Error al cargar vista principal: ' + (error.message || 'Error desconocido'),
      empleados: [],
      propinas: [],
      semana: new Date(),
      esAdmin: req.query.admin === 'true'
    });
  }
});

app.get('/admin', checkAuth, async (req, res) => {
  try {
    console.log('Intentando cargar empleados...');
    let empleados = await db.getEmpleados();
    console.log('Empleados encontrados:', empleados.length);
    
    // Si no hay empleados, crear algunos de prueba
    if (empleados.length === 0) {
      console.log('No hay empleados, creando empleados de prueba...');
      db.createSampleEmployees();
      empleados = await db.getEmpleados();
      console.log('Empleados después de crear pruebas:', empleados.length);
    }
    
    const fechaEditar = req.query.fecha || null;
    
    res.render('admin', { empleados, fechaEditar });
  } catch (error) {
    console.error('Error en ruta /admin:', error);
    res.render('admin', { 
      error: 'Error al cargar panel de administración: ' + (error.message || 'Error desconocido'),
      empleados: [],
      fechaEditar: null
    });
  }
});

app.get('/historico', async (req, res) => {
  try {
    const historico = await db.getHistorico();
    const esAdmin = req.session && req.session.authenticated || false;
    
    res.render('historico', { 
      historico, 
      esAdmin 
    });
  } catch (error) {
    console.error('Error en ruta /historico:', error);
    res.render('historico', { 
      error: 'Error al cargar histórico: ' + (error.message || 'Error desconocido'),
      historico: [],
      esAdmin: false
    });
  }
});

app.get('/empleados', async (req, res) => {
  try {
    let empleados = await db.getEmpleados();
    
    // Si no hay empleados, crear algunos de prueba
    if (empleados.length === 0) {
      console.log('No hay empleados en /empleados, creando empleados de prueba...');
      db.createSampleEmployees();
      empleados = await db.getEmpleados();
    }
    
    const empleadoId = req.query.empleado ? parseInt(req.query.empleado) : null;
    
    if (req.query.empleado && isNaN(parseInt(req.query.empleado))) {
      throw new Error('ID de empleado inválido');
    }
    
    // Determinar la fecha de inicio de semana
    let inicioSemana;
    if (req.query.semana) {
      // Crear una fecha al mediodía para evitar problemas de timezone
      const [year, month, day] = req.query.semana.split('-').map(num => parseInt(num, 10));
      inicioSemana = new Date(year, month - 1, day, 12, 0, 0);
      
      if (isNaN(inicioSemana.getTime())) {
        throw new Error('Fecha inválida');
      }
    } else {
      // Obtener el lunes de la semana actual a las 12 del mediodía
      const fechaActual = new Date();
      // Ajustar a mediodía
      fechaActual.setHours(12, 0, 0, 0);
      // Obtener el lunes (día 1 de la semana)
      inicioSemana = new Date(fechaActual);
      inicioSemana.setDate(fechaActual.getDate() - fechaActual.getDay() + 1);
    }
    
    let propinas;
    if (empleadoId) {
      propinas = await db.getPropinasPorEmpleadoSemana(empleadoId, inicioSemana);
    } else {
      propinas = await db.getPropinasSemana(inicioSemana);
    }
    
    // Calcular el total de la semana
    let totalSemana = 0;
    propinas.forEach(propina => {
      if (empleadoId && propina.monto_individual) {
        totalSemana += propina.monto_individual;
      } else if (!empleadoId && propina.monto_por_empleado) {
        totalSemana += propina.monto_por_empleado;
      }
    });
    
    res.render('empleados', { 
      empleados, 
      propinas, 
      semana: inicioSemana,
      empleadoSeleccionado: empleadoId,
      totalSemana: totalSemana
    });
  } catch (error) {
    console.error('Error en ruta /empleados:', error);
    res.render('empleados', { 
      error: 'Error al cargar vista de empleados: ' + (error.message || 'Error desconocido'),
      empleados: [],
      propinas: [],
      semana: new Date(),
      empleadoSeleccionado: null,
      totalSemana: 0
    });
  }
});

// Nueva ruta para la vista de modificación
app.get('/modificacion', checkAuth, async (req, res) => {
  try {
    // Solo permita acceso a usuarios autenticados (admins)
    if (!req.session || !req.session.authenticated) {
      return res.redirect('/login?redirect=/modificacion');
    }
    
    const historico = await db.getHistorico();
    const esAdmin = true; // Esta ruta solo es accesible para admins
    
    res.render('modificacion', { 
      historico, 
      esAdmin 
    });
  } catch (error) {
    console.error('Error en ruta /modificacion:', error);
    res.render('modificacion', { 
      error: 'Error al cargar datos: ' + (error.message || 'Error desconocido'),
      historico: [],
      esAdmin: true
    });
  }
});

app.get('/admin/modificacion', checkAuth, async (req, res) => {
  try {
    // Solo permita acceso a usuarios autenticados (admins)
    if (!req.session || !req.session.authenticated) {
      return res.redirect('/login?redirect=/admin/modificacion');
    }
    
    const historico = await db.getHistorico();
    const esAdmin = true; // Esta ruta solo es accesible para admins
    
    res.render('admin_modificacion', { 
      historico, 
      esAdmin,
      titulo: "Panel de Modificación de Propinas",
      descripcion: "Modifica o elimina registros de propinas"
    });
  } catch (error) {
    console.error('Error en ruta /admin/modificacion:', error);
    res.render('admin_modificacion', { 
      error: 'Error al cargar histórico: ' + (error.message || 'Error desconocido'),
      historico: [],
      esAdmin: true,
      titulo: "Panel de Modificación de Propinas",
      descripcion: "Modifica o elimina registros de propinas"
    });
  }
});

// API Routes
app.post('/api/empleados', async (req, res) => {
  try {
    const { nombre } = req.body;
    
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ error: 'El nombre del empleado es requerido' });
    }
    
    await db.addEmpleado(nombre);
    res.json({ success: true });
  } catch (error) {
    console.error('Error en API /api/empleados:', error);
    res.status(500).json({ error: error.message || 'Error al agregar empleado' });
  }
});

// Nueva ruta para obtener todos los empleados
app.get('/api/empleados', async (req, res) => {
  try {
    const empleados = await db.getEmpleados();
    res.json(empleados);
  } catch (error) {
    console.error('Error en API GET /api/empleados:', error);
    res.status(500).json({ error: error.message || 'Error al obtener empleados' });
  }
});

app.put('/api/empleados/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre } = req.body;
    
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({ error: 'El nombre del empleado es requerido' });
    }
    
    if (isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'ID de empleado inválido' });
    }
    
    await db.updateEmpleado(id, nombre);
    res.json({ success: true });
  } catch (error) {
    console.error('Error en API PUT /api/empleados/:id:', error);
    res.status(500).json({ error: error.message || 'Error al actualizar empleado' });
  }
});

app.delete('/api/empleados/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteEmpleado(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/propinas', async (req, res) => {
  try {
    const { fecha, empleados, monto, notas } = req.body;
    
    if (!fecha) {
      return res.status(400).json({ error: 'La fecha es requerida' });
    }
    
    if (!empleados || !Array.isArray(empleados) || empleados.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un empleado' });
    }
    
    if (!monto || isNaN(parseFloat(monto)) || parseFloat(monto) <= 0) {
      return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }
    
    const result = await db.addPropina(fecha, empleados, monto, notas);
    res.json({ success: true, updated: result.wasUpdated });
  } catch (error) {
    console.error('Error en API POST /api/propinas:', error);
    res.status(500).json({ error: error.message || 'Error al guardar propinas' });
  }
});

app.get('/api/propinas/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;

    if (!fecha || !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }

    const propina = await db.getPropinasPorFecha(fecha);

    if (!propina) {
      return res.status(404).json({ error: 'No se encontraron propinas para esta fecha' });
    }

    // Ya no envolver en arreglo y ya no forzar empleado_nombre plano
    res.json(propina);
  } catch (error) {
    console.error('Error en API GET /api/propinas/:fecha:', error);
    res.status(500).json({ error: error.message || 'Error al obtener propinas' });
  }
});

// API para actualizar propinas (para la página de modificación)
app.put('/api/propinas/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;
    const { monto, notas, empleados } = req.body;
    
    if (!fecha || !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }
    
    if (!monto || monto <= 0) {
      return res.status(400).json({ error: 'El monto total debe ser un número positivo' });
    }
    
    if (!empleados || !Array.isArray(empleados) || empleados.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un empleado' });
    }
    
    // Obtener la propina existente para esta fecha
    const propina = await db.getPropinasPorFecha(fecha);
    
    if (!propina) {
      return res.status(404).json({ error: 'No se encontró ninguna propina para esta fecha' });
    }
    
    // Actualizar con los empleados proporcionados
    const result = await db.addPropina(fecha, empleados, monto, notas);
    
    res.json({ 
      success: true, 
      updated: true,
      message: `Propina actualizada exitosamente para la fecha ${fecha}`
    });
  } catch (error) {
    console.error('Error en API PUT /api/propinas/:fecha:', error);
    res.status(500).json({ error: error.message || 'Error al actualizar propina' });
  }
});

// API para eliminar propinas (para la página de modificación)
app.delete('/api/propinas/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;
    
    if (!fecha || !fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Formato de fecha inválido. Use YYYY-MM-DD' });
    }
    
    // Verificar que existe la propina
    const propina = await db.getPropinasPorFecha(fecha);
    
    if (!propina) {
      return res.status(404).json({ error: 'No se encontró ninguna propina para esta fecha' });
    }
    
    // Eliminar la propina
    await db.deletePropina(fecha);
    
    res.json({ 
      success: true, 
      message: `Propina eliminada exitosamente para la fecha ${fecha}`
    });
  } catch (error) {
    console.error('Error en API DELETE /api/propinas/:fecha:', error);
    res.status(500).json({ error: error.message || 'Error al eliminar propina' });
  }
});

// Ruta para resetear la base de datos (solo para admins)
app.post('/reset-database', checkAuth, async (req, res) => {
  try {
    if (!req.session || !req.session.authenticated) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    await db.reset();
    res.json({ success: true, message: 'Base de datos reseteada exitosamente' });
  } catch (error) {
    console.error('Error al resetear la base de datos:', error);
    res.status(500).json({ error: 'Error al resetear la base de datos: ' + error.message });
  }
});

// Ruta para crear empleados de prueba (solo para admins)
app.post('/create-sample-employees', checkAuth, async (req, res) => {
  try {
    if (!req.session || !req.session.authenticated) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    db.createSampleEmployees();
    const empleados = await db.getEmpleados();
    
    res.json({ 
      success: true, 
      message: `Se crearon empleados de prueba. Total: ${empleados.length}`,
      empleados: empleados
    });
  } catch (error) {
    console.error('Error al crear empleados de prueba:', error);
    res.status(500).json({ error: 'Error al crear empleados de prueba: ' + error.message });
  }
});

// Ruta de prueba para verificar la base de datos
app.get('/test-db', checkAuth, async (req, res) => {
  try {
    const empleados = await db.getEmpleados();
    const allEmpleados = await db.getAllEmpleados();
    const historico = await db.getHistorico();
    
    res.json({
      empleados_activos: empleados,
      todos_empleados: allEmpleados,
      historico: historico,
      empleados_count: empleados.length,
      total_empleados_count: allEmpleados.length
    });
  } catch (error) {
    console.error('Error en test-db:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Acceso desde celular: http://[IP_DE_TU_COMPUTADORA]:${PORT}`);
  console.log(`🔐 Contraseña: cafe123`);
});
