const Database = require('better-sqlite3');
const path = require('path');

class PropinaDatabase {
  constructor() {
    this.db = new Database(path.join(__dirname, 'propinas.db'));
    this.db.pragma('journal_mode = WAL');
    // Ejemplo de pragma adicional para optimización
    this.db.exec("PRAGMA synchronous = NORMAL;");
  }

  init() {
    // Tabla de empleados
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS empleados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        activo BOOLEAN DEFAULT 1,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de propinas por día (simplificada)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS propinas_dia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha DATE NOT NULL UNIQUE,
        monto_total REAL NOT NULL,
        notas TEXT,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de empleados que trabajaron cada día
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS empleados_dia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        propina_dia_id INTEGER,
        empleado_id INTEGER,
        monto_individual REAL NOT NULL,
        notas_empleado TEXT,
        FOREIGN KEY (propina_dia_id) REFERENCES propinas_dia(id),
        FOREIGN KEY (empleado_id) REFERENCES empleados(id)
      )
    `);

    // Horario regular: qué día de la semana trabaja cada empleado (0=domingo, 1=lunes, ..., 6=sábado)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS empleado_dias_trabajo (
        empleado_id INTEGER NOT NULL,
        dia_semana INTEGER NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
        PRIMARY KEY (empleado_id, dia_semana),
        FOREIGN KEY (empleado_id) REFERENCES empleados(id)
      )
    `);

    // Insertar empleados de ejemplo si no existen
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM empleados");
    const result = countStmt.get();
    
    if (result.count === 0) {
      this.createSampleEmployees();
    }
  }

  // Método para crear empleados de prueba
  createSampleEmployees() {
    const empleadosEjemplo = [
      'Ana García', 'Carlos López', 'María Torres', 'Juan Pérez',
      'Laura Sánchez', 'Pedro Martín', 'Sofia Ruiz', 'Diego Herrera'
    ];
    
    const insertStmt = this.db.prepare("INSERT INTO empleados (nombre) VALUES (?)");
    empleadosEjemplo.forEach(nombre => {
      try {
        insertStmt.run(nombre);
        console.log(`Empleado creado: ${nombre}`);
      } catch (error) {
        console.log(`Empleado ya existe o error: ${nombre}`);
      }
    });
  }

  // Método para resetear la base de datos
  reset() {
    this.db.exec("DROP TABLE IF EXISTS empleado_dias_trabajo");
    this.db.exec("DROP TABLE IF EXISTS empleados_dia");
    this.db.exec("DROP TABLE IF EXISTS propinas_dia");
    this.db.exec("DROP TABLE IF EXISTS empleados");
    this.init();
  }

  // --- Horario regular (días que trabaja cada empleado, 0=domingo..6=sábado) ---
  getDiasTrabajo(empleadoId) {
    const stmt = this.db.prepare("SELECT dia_semana FROM empleado_dias_trabajo WHERE empleado_id = ? ORDER BY dia_semana");
    return stmt.all(empleadoId).map((r) => r.dia_semana);
  }

  setDiasTrabajo(empleadoId, dias) {
    const del = this.db.prepare("DELETE FROM empleado_dias_trabajo WHERE empleado_id = ?");
    const ins = this.db.prepare("INSERT INTO empleado_dias_trabajo (empleado_id, dia_semana) VALUES (?, ?)");
    this.db.transaction(() => {
      del.run(empleadoId);
      const diasNum = (Array.isArray(dias) ? dias : []).map((d) => parseInt(d, 10)).filter((d) => !isNaN(d) && d >= 0 && d <= 6);
      diasNum.forEach((dia) => ins.run(empleadoId, dia));
    })();
  }

  getEmpleadosQueTrabajanDia(diaSemana) {
    const d = parseInt(diaSemana, 10);
    if (isNaN(d) || d < 0 || d > 6) return [];
    const stmt = this.db.prepare("SELECT empleado_id FROM empleado_dias_trabajo WHERE dia_semana = ?");
    return stmt.all(d).map((r) => r.empleado_id);
  }

  getAllHorarioRegular() {
    const empleados = this.getEmpleados();
    return empleados.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      dias: this.getDiasTrabajo(e.id)
    }));
  }

  // Métodos para propinas
  addPropina(fecha, empleadosIds, montoTotal, notas) {
    const ids = Array.isArray(empleadosIds)
      ? empleadosIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))
      : [];
    if (ids.length === 0) throw new Error('Se requiere al menos un empleado válido');

    const transaction = this.db.transaction((f, eIds, monto, n) => {
      // Verificar si ya existe una propina para esta fecha
      const checkExistingStmt = this.db.prepare("SELECT id FROM propinas_dia WHERE fecha = ?");
      const existing = checkExistingStmt.get(f);
      
      let propinasDiaId;
      let wasUpdated = false;
      
      if (existing) {
        // Actualizar la propina existente
        const updateDiaStmt = this.db.prepare("UPDATE propinas_dia SET monto_total = ?, notas = ? WHERE id = ?");
        updateDiaStmt.run(monto, n, existing.id);
        
        // Eliminar los empleados existentes para esta propina
        const deleteEmpleadosStmt = this.db.prepare("DELETE FROM empleados_dia WHERE propina_dia_id = ?");
        deleteEmpleadosStmt.run(existing.id);
        
        propinasDiaId = existing.id;
        wasUpdated = true;
      } else {
        // Insertar una nueva propina
        const insertDiaStmt = this.db.prepare("INSERT INTO propinas_dia (fecha, monto_total, notas) VALUES (?, ?, ?)");
        const result = insertDiaStmt.run(f, monto, n);
        propinasDiaId = result.lastInsertRowid;
      }
      
      const montoPorEmpleado = monto / eIds.length;

      const insertEmpleadoStmt = this.db.prepare("INSERT INTO empleados_dia (propina_dia_id, empleado_id, monto_individual) VALUES (?, ?, ?)");
      eIds.forEach(empleadoId => {
        insertEmpleadoStmt.run(propinasDiaId, empleadoId, montoPorEmpleado);
      });

      return { propinasDiaId, wasUpdated };
    });

    return transaction(fecha, ids, montoTotal, notas || '');
  }

  updatePropina(fecha, montoTotal, notas = '') {
    const stmt = this.db.prepare("UPDATE propinas_dia SET monto_total = ?, notas = ? WHERE fecha = ?");
    return stmt.run(montoTotal, notas, fecha);
  }

  getPropinasSemana(fechaInicio) {
    const fechaInicioStr = this._dateToYYYYMMDD(fechaInicio);
    const [year, month, day] = fechaInicioStr.split('-').map(num => parseInt(num, 10));
    const fechaFin = new Date(year, month - 1, parseInt(day) + 6, 12, 0, 0);
    const fechaFinStr = this._dateToYYYYMMDD(fechaFin);

    const query = `
      SELECT 
        pd.fecha,
        pd.monto_total,
        pd.notas,
        GROUP_CONCAT(e.nombre) as empleados_nombres,
        GROUP_CONCAT(e.id) as empleados_ids,
        COUNT(ed.empleado_id) as total_empleados,
        CASE WHEN COUNT(ed.empleado_id) > 0 
          THEN pd.monto_total / COUNT(ed.empleado_id) 
          ELSE 0 
        END as monto_por_empleado
      FROM propinas_dia pd
      LEFT JOIN empleados_dia ed ON pd.id = ed.propina_dia_id
      LEFT JOIN empleados e ON ed.empleado_id = e.id
      WHERE pd.fecha BETWEEN ? AND ?
      GROUP BY pd.id, pd.fecha
      ORDER BY pd.fecha
    `;
    const stmt = this.db.prepare(query);
    return stmt.all(fechaInicioStr, fechaFinStr);
  }

  _dateToYYYYMMDD(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  getTotalesEmpleadosSemana(fechaInicio) {
    const fechaInicioStr = this._dateToYYYYMMDD(fechaInicio);
    const [year, month, day] = fechaInicioStr.split('-').map(num => parseInt(num, 10));
    const fechaFin = new Date(year, month - 1, parseInt(day) + 6, 12, 0, 0);
    const fechaFinStr = this._dateToYYYYMMDD(fechaFin);

    // Solo sumar monto_individual cuando la propina es de esta semana (pd.fecha en rango)
    const query = `
      SELECT 
        e.id,
        e.nombre,
        COALESCE(SUM(CASE WHEN pd.fecha BETWEEN ? AND ? THEN ed.monto_individual ELSE 0 END), 0) as total_semana
      FROM empleados e
      LEFT JOIN empleados_dia ed ON ed.empleado_id = e.id
      LEFT JOIN propinas_dia pd ON ed.propina_dia_id = pd.id
      WHERE e.activo = 1
      GROUP BY e.id, e.nombre
      ORDER BY total_semana DESC, e.nombre
    `;
    const stmt = this.db.prepare(query);
    return stmt.all(fechaInicioStr, fechaFinStr);
  }

  getPropinasPorEmpleadoSemana(empleadoId, fechaInicio) {
    const fechaInicioStr = this._dateToYYYYMMDD(fechaInicio);
    const [year, month, day] = fechaInicioStr.split('-').map(num => parseInt(num, 10));
    const fechaFin = new Date(year, month - 1, parseInt(day) + 6, 12, 0, 0);
    const fechaFinStr = this._dateToYYYYMMDD(fechaFin);

    const query = `
      SELECT 
        pd.fecha,
        pd.monto_total,
        pd.notas,
        CASE 
          WHEN (SELECT COUNT(*) FROM empleados_dia WHERE propina_dia_id = pd.id) = 0 THEN 0
          WHEN EXISTS (SELECT 1 FROM empleados_dia WHERE propina_dia_id = pd.id AND empleado_id = ?)
          THEN pd.monto_total / (SELECT COUNT(*) FROM empleados_dia WHERE propina_dia_id = pd.id)
          ELSE 0
        END as monto_individual,
        GROUP_CONCAT(e.nombre) as empleados_nombres,
        GROUP_CONCAT(e.id) as empleados_ids,
        COUNT(ed.empleado_id) as total_empleados_dia,
        (SELECT COUNT(*) FROM empleados_dia WHERE propina_dia_id = pd.id) as total_empleados,
        CASE WHEN (SELECT COUNT(*) FROM empleados_dia WHERE propina_dia_id = pd.id) > 0
          THEN pd.monto_total / (SELECT COUNT(*) FROM empleados_dia WHERE propina_dia_id = pd.id)
          ELSE 0
        END as monto_por_empleado
      FROM propinas_dia pd
      LEFT JOIN empleados_dia ed ON pd.id = ed.propina_dia_id
      LEFT JOIN empleados e ON ed.empleado_id = e.id
      WHERE pd.fecha BETWEEN ? AND ?
      GROUP BY pd.id, pd.fecha
      ORDER BY pd.fecha
    `;
    const stmt = this.db.prepare(query);
    return stmt.all(empleadoId, fechaInicioStr, fechaFinStr);
  }

  getPropinasPorFecha(fecha) {
    // Primero obtenemos la información general del día
    const propinaDiaQuery = `
      SELECT 
        id,
        fecha,
        monto_total,
        notas
      FROM propinas_dia
      WHERE fecha = ?
    `;
    
    const propinaDiaStmt = this.db.prepare(propinaDiaQuery);
    const propinaDia = propinaDiaStmt.get(fecha);
    
    if (!propinaDia) {
      return null; // No hay propinas para esta fecha
    }
    
    // Luego obtenemos los empleados que trabajaron ese día
    const empleadosDiaQuery = `
      SELECT DISTINCT
        ed.empleado_id,
        e.nombre as empleado_nombre,
        ed.monto_individual,
        ed.notas_empleado
      FROM empleados_dia ed
      JOIN empleados e ON ed.empleado_id = e.id
      WHERE ed.propina_dia_id = ?
      ORDER BY e.nombre
    `;
    
    const empleadosDiaStmt = this.db.prepare(empleadosDiaQuery);
    const empleadosDia = empleadosDiaStmt.all(propinaDia.id);
    
    // Combinamos los resultados
    return {
      ...propinaDia,
      empleados: empleadosDia,
      total_empleados: empleadosDia.length
    };
  }

  deletePropina(fecha) {
    const transaction = this.db.transaction((f) => {
      const getIdStmt = this.db.prepare("SELECT id FROM propinas_dia WHERE fecha = ?");
      const propina = getIdStmt.get(f);
      
      if (propina) {
        // Eliminar empleados relacionados
        const deleteEmpleadosStmt = this.db.prepare("DELETE FROM empleados_dia WHERE propina_dia_id = ?");
        deleteEmpleadosStmt.run(propina.id);
        
        // Eliminar propina
        const deletePropinaStmt = this.db.prepare("DELETE FROM propinas_dia WHERE id = ?");
        deletePropinaStmt.run(propina.id);
      }
    });
    
    return transaction(fecha);
  }

  getHistorico() {
    const query = `
      SELECT 
        pd.id,
        pd.fecha,
        pd.monto_total,
        pd.notas,
        COUNT(ed.empleado_id) as total_empleados,
        CASE 
          WHEN COUNT(ed.empleado_id) > 0 THEN pd.monto_total / COUNT(ed.empleado_id) 
          ELSE 0 
        END as monto_por_empleado,
        CASE 
          WHEN COUNT(ed.empleado_id) > 0 THEN pd.monto_total / COUNT(ed.empleado_id) 
          ELSE 0 
        END as monto_individual
      FROM propinas_dia pd
      LEFT JOIN empleados_dia ed ON pd.id = ed.propina_dia_id
      GROUP BY pd.id, pd.fecha
      ORDER BY pd.fecha DESC
    `;
    
    const stmt = this.db.prepare(query);
    return stmt.all();
  }

  // Métodos para empleados
  getEmpleados() {
    const stmt = this.db.prepare("SELECT * FROM empleados WHERE activo = 1 ORDER BY nombre");
    return stmt.all();
  }

  getAllEmpleados() {
    const stmt = this.db.prepare("SELECT * FROM empleados ORDER BY nombre");
    return stmt.all();
  }

  addEmpleado(nombre) {
    const stmt = this.db.prepare("INSERT INTO empleados (nombre) VALUES (?)");
    return stmt.run(nombre);
  }

  updateEmpleado(id, nombre) {
    const stmt = this.db.prepare("UPDATE empleados SET nombre = ? WHERE id = ?");
    return stmt.run(nombre, id);
  }

  deleteEmpleado(id) {
    const transaction = this.db.transaction((empId) => {
      // Marcar como inactivo en lugar de eliminar
      const deactivateStmt = this.db.prepare("UPDATE empleados SET activo = 0 WHERE id = ?");
      deactivateStmt.run(empId);
    });
    return transaction(id);
  }

  reactivateEmpleado(id) {
    const stmt = this.db.prepare("UPDATE empleados SET activo = 1 WHERE id = ?");
    return stmt.run(id);
  }
}

module.exports = PropinaDatabase;
