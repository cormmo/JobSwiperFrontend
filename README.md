# JobSwiper Frontend

Simple Bootstrap 5 interface for the sibling `JobSwiperBackend` API. The frontend runs on port 8081 and calls the backend on port 8080 directly from the browser.

Start `JobSwiperBackend` first, then run `./mvnw spring-boot:run` in this project and open `http://localhost:8081`. Both apps should be accessed through `localhost` (or both through `127.0.0.1`) so the backend's CORS origin matches.

The interface includes registration and login, employee and employer profiles, image upload, job management, job and candidate swipes, matches, and admin moderation. JWTs are kept in browser session storage and removed on logout.
