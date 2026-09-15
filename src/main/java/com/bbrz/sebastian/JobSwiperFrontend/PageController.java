package com.bbrz.sebastian.JobSwiperFrontend;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {
    @GetMapping({"/login", "/register", "/dashboard", "/employer/dashboard", "/profile/edit",
            "/employer/profile/edit", "/jobs/manage", "/jobs/swipe", "/candidates/swipe",
            "/matches", "/admin"})
    public String app() {
        return "forward:/index.html";
    }
}
