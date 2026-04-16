# AccounTrack™ Pro - Full-Stack Nigerian ERP

## Overview
AccounTrack™ Pro is a complete, production-ready ERP system designed specifically for Nigerian businesses. It includes accounting, invoicing, billing, inventory management, payroll (NTA 2025 compliant), asset depreciation, financial reporting, and audit trails.

## Tech Stack
- **Backend**: Node.js + Express + MongoDB
- **Frontend**: HTML/CSS/JS (single-page application)
- **Authentication**: JWT (JSON Web Tokens)
- **Database**: MongoDB with Mongoose ODM

## Features
- Multi-tenant architecture (each company isolated)
- User roles: Admin, Accountant, Viewer
- Double-entry accounting with full journal entries
- Chart of Accounts (industry-specific templates)
- Customer & Vendor management
- Invoicing with VAT (7.5%) and payment tracking
- Bill management with WHT deduction
- Inventory management with COGS posting at sale
- Payroll with PAYE calculation (NTA 2025)
- Fixed asset register with depreciation
- Budgeting and variance analysis
- Financial reports: P&L, Balance Sheet, Trial Balance, Cash Flow, VAT Summary
- AR/AP Aging reports
- Audit trail for all actions
- Data export/import (backup/restore)
- Dark mode
- Mobile responsive

## Installation

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (local or Atlas)
- npm or yarn

### Backend Setup

1. Clone the repository and navigate to the backend folder:
```bash
cd backend