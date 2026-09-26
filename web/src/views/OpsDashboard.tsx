import React from 'react';
import { opsKPIs, mockIncidents } from '../mockData';

export function OpsDashboardView() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">City Operations</h1>
          <div className="page-subtitle">Real-time overview of shelter capacity and active incidents.</div>
        </div>
        <button className="btn btn-primary">Download Daily Brief</button>
      </div>

      <div className="grid-cards">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Total Bed Capacity</span>
            <span className="badge blue">System Wide</span>
          </div>
          <div className="card-value">{opsKPIs.totalBeds}</div>
        </div>
        
        <div className="card">
          <div className="card-header">
            <span className="card-title">Occupied Beds</span>
            <span className="badge amber">Warning</span>
          </div>
          <div className="card-value text-amber">{opsKPIs.occupiedBeds}</div>
          <div className="card-trend text-amber">82% utilization</div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Capacity Gap</span>
            <span className="badge red">Critical</span>
          </div>
          <div className="card-value text-red">{opsKPIs.capacityGap} beds short</div>
          <div className="card-trend text-red">Based on unsheltered count</div>
        </div>

        <div className="card bg-blue-soft" style={{ borderColor: 'var(--blue)' }}>
          <div className="card-header">
            <span className="card-title text-blue">Weather Alert</span>
          </div>
          <div className="card-value text-blue" style={{ fontSize: '1.25rem' }}>{opsKPIs.weatherAlert}</div>
          <div className="card-trend text-blue">Warming centers activated</div>
        </div>
      </div>

      <h3>Active Incidents ({opsKPIs.activeIncidents})</h3>
      <div className="card" style={{ marginTop: '16px', padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Incident ID</th>
              <th>Type</th>
              <th>Location</th>
              <th>Time</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mockIncidents.map(inc => (
              <tr key={inc.id}>
                <td style={{ fontWeight: 600 }}>{inc.id}</td>
                <td>{inc.type}</td>
                <td>{inc.location}</td>
                <td className="text-muted">{inc.time}</td>
                <td>
                  <span className={`badge ${inc.severity === 'critical' ? 'red' : 'blue'}`}>
                    {inc.severity}
                  </span>
                </td>
                <td>{inc.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
