<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Validate and sanitize inputs
    $name = filter_input(INPUT_POST, 'name', FILTER_SANITIZE_STRING);
    $phone = filter_input(INPUT_POST, 'phone', FILTER_SANITIZE_NUMBER_INT);
    $email = filter_input(INPUT_POST, 'email', FILTER_SANITIZE_EMAIL);
    $message = filter_input(INPUT_POST, 'message', FILTER_SANITIZE_STRING);

    $errors = [];

    if (empty($name)) {
        $errors[] = "Name is required.";
    }

    if (empty($phone) || strlen($phone) != 10 || !ctype_digit($phone)) {
        $errors[] = "Valid 10-digit phone number is required.";
    }

    if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $errors[] = "Valid email is required.";
    }

    if (empty($message)) {
        $errors[] = "Message is required.";
    }

    if (empty($errors)) {
        // Process the data (e.g., send an email, save to database)
        $to = "vientrevor@gmail.com"; // Replace with your email address
        $subject = "New Contact Form Submission";
        $body = "Name: $name\nPhone: $phone\nEmail: $email\nMessage: $message";
        
        if (mail($to, $subject, $body)) {
            // Redirect to a thank you page
            header("Location: thank_you.html");
            exit();
        } else {
            $errors[] = "Failed to send email. Please try again later.";
        }
    }

    if (!empty($errors)) {
        // If there are errors, you might want to redirect back to the form
        // with error messages, or display them on the same page
        foreach ($errors as $error) {
            echo $error . "<br>";
        }
    }
} else {
    // If someone tries to access this script directly, redirect them
    header("Location: index.html");
    exit();
}
?>