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

// Middleware de autenticación (redirige a login)
const checkAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
};

// Para APIs: responde con 401 JSON en lugar de redirigir
const checkAuthApi = (req, res, next) => {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
};

// Fecha local como YYYY-MM-DD (evita desfase por timezone de toISOString)
function dateToLocalStr(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Lunes de la semana de una fecha (hora 12:00 local)
function getInicioSemanaFromQuery(semanaQuery) {
  if (!semanaQuery || !/^\d{4}-\d{2}-\d{2}$/.test(semanaQuery)) return null;
  const [year, month, day] = semanaQuery.split('-').map((n) => parseInt(n, 10));
  const d = new Date(year, month - 1, day, 12, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

// Lunes de la semana actual (local)
function getInicioSemanaActual() {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const lunes = new Date(now);
  lunes.setDate(now.getDate() + diff);
  return lunes;
}

// Función de ayuda para formatear fechas sin problemas de zona horaria
const formatearFecha = (fechaString, opcion) => {
  if (!fechaString || typeof fechaString !== 'string') return '';
  const parts = fechaString.split('-').map((num) => parseInt(num, 10));
  if (parts.length !== 3) return fechaString;
  const [year, month, day] = parts;

  const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const fecha = new Date(year, month - 1, day, 12, 0, 0);
  if (isNaN(fecha.getTime())) return fechaString;

  if (opcion === 'diaSemana') return diasSemana[fecha.getDay()];
  if (opcion === 'completa') return `${day} de ${meses[month - 1]} de ${year}`;
  if (opcion === 'corta') return `${day}/${month}/${year}`;
  if (opcion === 'diaDelMes') return `${day}`;
  if (opcion === 'mes') return meses[month - 1];
  if (opcion === 'año') return `${year}`;
  return fechaString;
};

// Middleware para añadir la función de formateo a todas las vistas
app.use((req, res, next) => {
  res.locals.formatearFecha = formatearFecha;
  next();
});

// Rutas
app.get('/', (req, res) => {
  res.redirect(302, '/empleados/' + dateToLocalStr(getInicioSemanaActual()));
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
    const inicioSemana = getInicioSemanaFromQuery(req.query.semana) || getInicioSemanaActual();
    const propinas = await db.getPropinasSemana(inicioSemana);
    res.render('main', {
      empleados,
      propinas,
      semana: inicioSemana,
      semanaStr: dateToLocalStr(inicioSemana),
      esAdmin: req.query.admin === 'true'
    });
  } catch (error) {
    res.render('main', {
      error: 'Error al cargar vista principal: ' + (error.message || 'Error desconocido'),
      empleados: [],
      propinas: [],
      semana: getInicioSemanaActual(),
      semanaStr: dateToLocalStr(getInicioSemanaActual()),
      esAdmin: false
    });
  }
});

app.get('/admin', checkAuth, async (req, res) => {
  try {
    let empleados = await db.getEmpleados();
    if (empleados.length === 0) {
      db.createSampleEmployees();
      empleados = await db.getEmpleados();
    }
    const fechaEditar = req.query.fecha || null;
    const hoyStr = dateToLocalStr(new Date());
    res.render('admin', { empleados, fechaEditar, hoyStr });
  } catch (error) {
    res.render('admin', {
      error: 'Error al cargar panel de administración: ' + (error.message || 'Error desconocido'),
      empleados: [],
      fechaEditar: null,
      hoyStr: dateToLocalStr(new Date())
    });
  }
});

app.get('/admin/horario', checkAuth, async (req, res) => {
  try {
    let empleados = await db.getEmpleados();
    if (empleados.length === 0) {
      db.createSampleEmployees();
      empleados = await db.getEmpleados();
    }
    res.render('admin_horario', { empleados });
  } catch (error) {
    res.render('admin_horario', {
      error: error.message || 'Error al cargar',
      empleados: []
    });
  }
});

app.get('/admin/empleados', checkAuth, async (req, res) => {
  try {
    let empleados = await db.getEmpleados();
    if (empleados.length === 0) {
      db.createSampleEmployees();
      empleados = await db.getEmpleados();
    }
    res.render('admin_empleados', { empleados });
  } catch (error) {
    res.render('admin_empleados', {
      error: error.message || 'Error al cargar',
      empleados: []
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
    res.render('historico', { 
      error: 'Error al cargar histórico: ' + (error.message || 'Error desconocido'),
      historico: [],
      esAdmin: false
    });
  }
});

// Vista principal: /empleados (redirige a semana actual) y /empleados/:semana (YYYY-MM-DD)
app.get(['/empleados', '/empleados/:semana'], async (req, res) => {
  const semanaParam = req.params.semana;
  const tieneSemanaValida = semanaParam && /^\d{4}-\d{2}-\d{2}$/.test(semanaParam);

  // Sin semana o fecha inválida → redirigir a semana actual
  if (!tieneSemanaValida) {
    const semanaStr = dateToLocalStr(getInicioSemanaActual());
    const query = (req.originalUrl && req.originalUrl.includes('?')) ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    return res.redirect(302, '/empleados/' + semanaStr + query);
  }

  const inicioSemana = getInicioSemanaFromQuery(semanaParam);
  if (!inicioSemana) {
    return res.redirect(302, '/empleados/' + dateToLocalStr(getInicioSemanaActual()));
  }
  const semanaStr = dateToLocalStr(inicioSemana);

  try {
    let empleados = await db.getEmpleados();
    if (empleados.length === 0) {
      db.createSampleEmployees();
      empleados = await db.getEmpleados();
    }
    const empleadoId = req.query.empleado ? parseInt(req.query.empleado, 10) : null;
    if (req.query.empleado != null && (isNaN(empleadoId) || empleadoId < 1)) {
      return res.redirect(302, '/empleados/' + semanaStr);
    }

    const propinas = empleadoId
      ? await db.getPropinasPorEmpleadoSemana(empleadoId, inicioSemana)
      : await db.getPropinasSemana(inicioSemana);

    let totalSemana = 0;
    propinas.forEach((p) => {
      const val = empleadoId ? p.monto_individual : p.monto_por_empleado;
      if (val != null && !isNaN(val)) totalSemana += val;
    });

    const totalesEmpleados = await db.getTotalesEmpleadosSemana(inicioSemana);
    const totalRepartidoSemana = totalesEmpleados.reduce((s, e) => s + (Number(e.total_semana) || 0), 0);

    res.render('empleados', {
      empleados,
      propinas,
      semana: inicioSemana,
      semanaStr,
      empleadoSeleccionado: empleadoId,
      totalSemana,
      totalRepartidoSemana,
      totalesEmpleados
    });
  } catch (error) {
    res.redirect(302, '/empleados/' + dateToLocalStr(getInicioSemanaActual()));
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
    res.render('admin_modificacion', { 
      error: 'Error al cargar histórico: ' + (error.message || 'Error desconocido'),
      historico: [],
      esAdmin: true,
      titulo: "Panel de Modificación de Propinas",
      descripcion: "Modifica o elimina registros de propinas"
    });
  }
});

// API Routes (empleados requieren admin)
app.post('/api/empleados', checkAuthApi, async (req, res) => {
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
    res.status(500).json({ error: error.message || 'Error al obtener empleados' });
  }
});

// Horario regular: obtener todos (empleado + días que trabaja, 0=domingo..6=sábado)
app.get('/api/horario-regular', checkAuthApi, async (req, res) => {
  try {
    const horario = await db.getAllHorarioRegular();
    res.json({ horario });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error al obtener horario' });
  }
});

// Horario regular: guardar días que trabaja un empleado
app.put('/api/empleados/:id/horario', checkAuthApi, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { dias } = req.body;
    if (isNaN(id) || id < 1) return res.status(400).json({ error: 'ID de empleado inválido' });
    if (!Array.isArray(dias)) return res.status(400).json({ error: 'dias debe ser un array (0=domingo..6=sábado)' });
    await db.setDiasTrabajo(id, dias);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error al guardar horario' });
  }
});

// Empleados que trabajan un día de la semana (para pre-seleccionar al registrar propina)
app.get('/api/empleados-por-dia/:dia', checkAuthApi, async (req, res) => {
  try {
    const dia = parseInt(req.params.dia, 10);
    if (isNaN(dia) || dia < 0 || dia > 6) {
      return res.status(400).json({ error: 'dia debe ser 0 (domingo) a 6 (sábado)' });
    }
    const empleadoIds = await db.getEmpleadosQueTrabajanDia(dia);
    res.json({ empleadoIds });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Error al obtener empleados' });
  }
});

app.put('/api/empleados/:id', checkAuthApi, async (req, res) => {
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

app.delete('/api/empleados/:id', checkAuthApi, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteEmpleado(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/propinas', checkAuthApi, async (req, res) => {
  try {
    const { fecha, empleados, monto, notas } = req.body;

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'La fecha es requerida (formato YYYY-MM-DD)' });
    }
    if (!empleados || !Array.isArray(empleados) || empleados.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un empleado' });
    }
    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }
    const result = await db.addPropina(fecha, empleados, montoNum, notas || '');
    res.json({ success: true, updated: result.wasUpdated });
  } catch (error) {
    console.error('Error en API POST /api/propinas:', error);
    res.status(500).json({ error: error.message || 'Error al guardar propinas' });
  }
});

app.get('/api/propinas/:fecha', checkAuthApi, async (req, res) => {
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
app.put('/api/propinas/:fecha', checkAuthApi, async (req, res) => {
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
app.delete('/api/propinas/:fecha', checkAuthApi, async (req, res) => {
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
