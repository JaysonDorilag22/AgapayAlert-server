# Agapay-server
AgapayAlert 


ACCOUNTS:

<!-- super_admin -->
SUPER_ADMIN
{
  "email": "johndoe@example.com",
  "password": "NewPassword123!"
}

<!-- city_admin -->
CITY_ADMIN
{
  "email": "cityadmin@gmail.com",
  "password": "NewPassword123!"
}

<!-- police_admin -->
POLICE_ADMIN
{
  "email": "policeadmin@gmail.com,
  "password": "NewPassword123!"
}

<!-- police_officer -->
POLICE_OFFICER
{
  "email": "policeofficer@gmail.com,
  "password": "NewPassword123!"
}

<!-- user -->
USER
{
  "email": "juandelacruz@gmail.com,
  "password": "NewPassword123!"
}

Taguig





Functionalities Implemented:
User Authentication:

User registration
Account verification
User login
User logout
Password reset (forgot password and reset password)
User Management:

Get user details
Update user details
Change user password
Delete user
Create user with specific roles
City Management:

Create a new city
Retrieve all cities
Retrieve a single city by ID
Update a city
Delete a city
Police Station Management:

Create a new police station
Retrieve all police stations
Retrieve a single police station by ID
Update a police station
Delete a police station
Report Management:

Create a new report
Update a report
Retrieve all reports
Delete a report
Assign a police station to a report
Middleware:

Authentication middleware to protect routes
Role-based authorization middleware
Error handling middleware
Utilities:

Send email utility
Upload files to Cloudinary utility
Generate JWT token utility
Create mail options utility
Configuration:

Database connection configuration
Mailtrap configuration for sending emails
Cloudinary configuration for file uploads
OneSignal configuration for push notifications
Passport configuration for Google OAuth