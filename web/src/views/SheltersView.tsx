import React from 'react';
import { mockShelters } from '../mockData';

export function SheltersView() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Shelters & Housing</h1>
          <div className="page-subtitle">Manage shelter capacity, availability, and emergency services frequencies.</div>
        </div>
        <button className="btn btn-primary">Add New Facility</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Facility Name</th>
              <th>Address</th>
              <th>Beds (Occ / Cap)</th>
              <th>Status</th>
              <th>Paramedic Freq.</th>
              <th>Police Freq.</th>
              <th>30-Day Trend</th>
            </tr>
          </thead>
          <tbody>
            {mockShelters.map(shelter => {
              const util = Math.round((shelter.occupancy / shelter.capacity) * 100);
              let statusColor = 'green';
              if (util > 90) statusColor = 'amber';
              if (util >= 100) statusColor = 'red';

              return (
                <tr key={shelter.id}>
                  <td style={{ fontWeight: 600, color: 'var(--blue)' }}>{shelter.name}</td>
                  <td className="text-muted">{shelter.address}</td>
                  <td>
                    <strong>{shelter.occupancy}</strong> / {shelter.capacity}
                    <div style={{ width: '100px', height: '4px', background: 'var(--surface-2)', marginTop: '4px', borderRadius: '2px' }}>
                      <div style={{ width: `${Math.min(util, 100)}%`, height: '100%', background: `var(--${statusColor})`, borderRadius: '2px' }} />
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${statusColor}`}>
                      {shelter.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className={shelter.paramedicFreq.includes('High') ? 'text-red' : 'text-muted'}>
                    {shelter.paramedicFreq}
                  </td>
                  <td className={shelter.policeFreq.includes('High') ? 'text-red' : 'text-muted'}>
                    {shelter.policeFreq}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: '24px', gap: '2px' }}>
                      {shelter.occupancy30d.map((val, i) => (
                        <div key={i} style={{ width: '4px', height: `${val}%`, background: 'var(--blue)', opacity: 0.5 + (i/20) }} />
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
