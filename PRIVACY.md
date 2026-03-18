# Privacy Policy – Help Desk Ticket Watch

**Last updated:** February 2025

## Overview

Help Desk Ticket Watch is a Chrome extension that warns help desk staff when someone else is viewing the same ticket, to avoid duplicate work and conflicting messages.

## Data We Collect

- **Ticket ID** – Parsed from the URL of the ticket page you are viewing  
- **Username** – Scraped from the ticket page (e.g., your name shown in the help desk UI)  
- **Device ID** – A random UUID stored locally to identify your browser install  
- **Page URL** – The full URL of the ticket page

## How We Use This Data

- To register that you are viewing a specific ticket  
- To send periodic heartbeats so other users see when you leave a ticket  
- To show you a warning banner when someone else is viewing the same ticket

## Where Data Is Sent

All data is sent **only** to a backend server that **you configure** (e.g., `http://localhost:8000` or your organization’s LAN server). The extension does not send data to any third party or to Google (other than the Chrome Web Store for installation).

## Local Storage

The extension stores in your browser:

- **Backend API URL** – The server address you set in the popup  
- **Device ID** – A random UUID for this browser install  

This data stays on your device and is not shared.

## Data Retention

- Records are held in memory on your backend server  
- A viewing record is removed when there has been no heartbeat for about 20 seconds (e.g., when you switch tabs or close the ticket)

## Remote Code

This extension does **not** load or execute remote code. It only fetches JSON data from your configured backend. No scripts are downloaded or run from the network.

## Permissions

- **tabs** – To detect tab switches so only the visible ticket tab is tracked  
- **storage** – To save your backend URL and device ID  
- **host_permissions** – To send requests to your configured backend server  

## Contact

For questions about this privacy policy or the extension, open an issue in the [GitHub repository](https://github.com/Nipunme7/Help_Desk_Extension).
